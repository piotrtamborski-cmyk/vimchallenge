/**
 * Headless engine: the same CodeMirror 6 + codemirror-vim code that runs in the browser,
 * driven key by key inside jsdom. Used by the judge (replaying an action log) and by the
 * conformance harness (comparing with reference Vim).
 *
 * vim-core keeps registers, search and macro state in a module-level global, so only one
 * session may be live at a time per JS realm. `createHeadlessSession` resets that state;
 * run concurrent replays in separate worker threads.
 */
import { JSDOM } from 'jsdom';
import { tokenText } from './keys.ts';
import { toCh, toCol } from './positions.ts';
import { applyVimProfile, editorProfileExtensions } from './profile.ts';
import type { InitialState, Mode, Pos, RegisterValue, Snapshot } from './types.ts';

type Mods = {
  state: typeof import('@codemirror/state');
  view: typeof import('@codemirror/view');
  commands: typeof import('@codemirror/commands');
  language: typeof import('@codemirror/language');
  vim: typeof import('@replit/codemirror-vim');
};

let dom: JSDOM | undefined;
let mods: Promise<Mods> | undefined;
let live: HeadlessSession | undefined;

function installDom(): JSDOM {
  const d = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  const w = d.window as unknown as Record<string, unknown>;
  const g = globalThis as Record<string, unknown>;
  // Event classes must come from jsdom, otherwise jsdom rejects them in dispatchEvent.
  const forced = ['window', 'document', 'Event', 'CustomEvent', 'KeyboardEvent', 'InputEvent', 'FocusEvent'];
  for (const key of forced) g[key] = w[key];
  // Everything else CodeMirror may look up as a global (Window, HTMLElement, getSelection, ...).
  for (const key of Object.getOwnPropertyNames(d.window)) {
    if (key in g) continue;
    try {
      g[key] = w[key];
    } catch {
      // Some jsdom getters (e.g. localStorage on an opaque origin) throw; CodeMirror does not need them.
    }
  }
  // jsdom has no layout engine; CodeMirror only needs these to exist.
  const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} });
  const proto = d.window.Range.prototype as unknown as Record<string, unknown>;
  proto.getClientRects = () => Object.assign([], { item: () => null });
  proto.getBoundingClientRect = rect;
  return d;
}

async function load(): Promise<Mods> {
  dom ??= installDom();
  mods ??= (async () => ({
    state: await import('@codemirror/state'),
    view: await import('@codemirror/view'),
    commands: await import('@codemirror/commands'),
    language: await import('@codemirror/language'),
    vim: await import('@replit/codemirror-vim'),
  }))();
  return mods;
}

const NAMED_KEYS: Record<string, string> = {
  '<Esc>': 'Escape', '<CR>': 'Enter', '<BS>': 'Backspace', '<Tab>': 'Tab', '<Space>': ' ',
  '<Del>': 'Delete', '<Up>': 'ArrowUp', '<Down>': 'ArrowDown', '<Left>': 'ArrowLeft', '<Right>': 'ArrowRight',
};
const KEY_CODES: Record<string, number> = { Enter: 13, Escape: 27, Backspace: 8, Tab: 9 };

function keyInit(token: string): KeyboardEventInit & { keyCode: number } {
  const ctrl = /^<C-(.)>$/.exec(token);
  if (ctrl) return { key: ctrl[1]!, ctrlKey: true, keyCode: 0 };
  const key = NAMED_KEYS[token] ?? token;
  return { key, keyCode: KEY_CODES[key] ?? 0 };
}

export interface HeadlessSession {
  feed(token: string): void;
  snapshot(): Snapshot;
  destroy(): void;
}

// The codemirror-vim objects are untyped JS (CM5-style API); keep the `any` in one place.
/* eslint-disable @typescript-eslint/no-explicit-any */
type CM = any;

export async function createHeadlessSession(initial: InitialState): Promise<HeadlessSession> {
  const m = await load();
  live?.destroy();
  const { EditorState } = m.state;
  const { EditorView } = m.view;
  const { vim, Vim, getCM } = m.vim;
  const window = dom!.window;

  (Vim as any).resetVimGlobalState_();
  applyVimProfile(Vim);

  const parent = window.document.createElement('div');
  window.document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initial.lines.join('\n'),
      extensions: [vim(), ...editorProfileExtensions(m)],
    }),
  });
  const cm: CM = getCM(view);
  // The adapter moves j/k by measured pixels (EditorView.moveVertically). jsdom has no layout,
  // and the judge must not depend on fonts anyway: move by buffer lines and let vim-core keep
  // the column. Screen-relative motions (H, M, L, <C-d>, gj, zt, …) stay unsupported.
  cm.findPosV = (start: { line: number; ch: number }, amount: number, unit: string) => {
    if (unit !== 'line') throw new Error(`screen-relative motion is not supported by the judge (${unit})`);
    const target = Math.min(Math.max(start.line + amount, cm.firstLine()), cm.lastLine());
    return { line: target, ch: start.ch };
  };
  const [line, col] = initial.cursor;
  cm.setCursor({ line: line - 1, ch: toCh(initial.lines[line - 1] ?? '', col) });
  view.focus();

  function insertText(text: string) {
    view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.type', scrollIntoView: true });
  }

  function promptKey(input: HTMLInputElement, type: 'keydown' | 'keyup', init: ReturnType<typeof keyInit>) {
    const e = new window.KeyboardEvent(type, { ...init, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'keyCode', { value: init.keyCode });
    Object.defineProperty(e, 'which', { value: init.keyCode });
    input.dispatchEvent(e);
    return e.defaultPrevented;
  }

  function feedPrompt(input: HTMLInputElement, token: string) {
    const init = keyInit(token);
    const prevented = promptKey(input, 'keydown', init);
    if (!prevented && promptInput(cm) === input) {
      if (token === '<BS>') {
        input.value = Array.from(input.value).slice(0, -1).join('');
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
      } else if (token !== '<CR>' && token !== '<Esc>') {
        const text = tokenText(token);
        if (text !== undefined) {
          input.value += text;
          input.dispatchEvent(new window.Event('input', { bubbles: true }));
        }
      }
    }
    if (promptInput(cm) === input) promptKey(input, 'keyup', init);
  }

  const session: HeadlessSession = {
    feed(token) {
      const input = promptInput(cm);
      if (input) return feedPrompt(input, token);
      const init = keyInit(token);
      const event = { ...init, code: '', preventDefault() {}, stopPropagation() {} };
      const handled = cm.state.vimPlugin.handleKey(event, view);
      if (handled || !cm.state.vim.insertMode) return;
      // Not consumed by vim in Insert mode: what the browser would do with the key.
      if (token === '<BS>') m.commands.deleteCharBackward(view);
      else if (token === '<Del>') m.commands.deleteCharForward(view);
      else {
        const text = tokenText(token);
        if (text !== undefined) insertText(text);
      }
    },
    snapshot() {
      return snapshotOf(cm, Vim);
    },
    destroy() {
      view.destroy();
      parent.remove();
      if (live === session) live = undefined;
    },
  };
  live = session;
  return session;
}

/** The `:` or `/` command line, if open. Notifications also use `state.dialog` but have no input. */
function promptInput(cm: CM): HTMLInputElement | null {
  return (cm.state.dialog as HTMLElement | null)?.querySelector('input') ?? null;
}

function toPos(cm: CM, p: { line: number; ch: number }): Pos {
  return [p.line + 1, toCol(cm.getLine(p.line) ?? '', p.ch)];
}

function snapshotOf(cm: CM, Vim: any): Snapshot {
  const vs = cm.state.vim;
  let mode: Mode = 'normal';
  if (promptInput(cm)) mode = 'cmdline';
  else if (vs.insertMode) mode = cm.state.overwrite ? 'replace' : 'insert';
  else if (vs.visualMode) mode = vs.visualBlock ? 'visual-block' : vs.visualLine ? 'visual-line' : 'visual';

  const lines: string[] = cm.getValue().split('\n');
  const snap: Snapshot = {
    lines,
    mode,
    cursor: toPos(cm, vs.visualMode ? vs.sel.head : cm.getCursor()),
    registers: {},
    marks: {},
  };
  if (vs.visualMode) snap.visual = { anchor: toPos(cm, vs.sel.anchor), head: toPos(cm, vs.sel.head) };

  const regs = Vim.getRegisterController().registers as Record<string, any>;
  for (const name of '"abcdefghijklmnopqrstuvwxyz') {
    const r = regs[name];
    if (!r) continue;
    let text: string = r.toString();
    if (name === '"' && text === '' && !r.linewise) continue;
    if (r.linewise && !text.endsWith('\n')) text += '\n';
    const value: RegisterValue = { type: r.blockwise ? 'block' : r.linewise ? 'line' : 'char', text };
    snap.registers[name] = value;
  }
  for (const [name, mark] of Object.entries(vs.marks as Record<string, any>)) {
    if (!/^[a-z]$/.test(name)) continue;
    const p = mark?.find?.();
    if (p) snap.marks[name] = toPos(cm, p);
  }
  return snap;
}
