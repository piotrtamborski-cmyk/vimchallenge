/**
 * One editor session: CodeMirror 6 + codemirror-vim with the shared profile, driven one
 * engine-level key at a time. The browser and the judge both run this code, so a key log
 * recorded in the browser replays to the same state on the server.
 *
 * vim-core keeps registers, search and macro state in a module-level global, so only one
 * session may be live at a time per JS realm. `createSession` resets that state.
 */
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { classifyChange } from './goals.ts';
import { tokenText } from './keys.ts';
import { toCh, toCol } from './positions.ts';
import { applyVimProfile, editorProfileExtensions } from './profile.ts';
import type { HistoryMove, InitialState, Mode, Pos, RegisterValue, Snapshot, Step } from './types.ts';

export type EngineModules = {
  state: typeof import('@codemirror/state');
  view: typeof import('@codemirror/view');
  commands: typeof import('@codemirror/commands');
  language: typeof import('@codemirror/language');
  vim: typeof import('@replit/codemirror-vim');
};

export interface Session {
  readonly view: EditorView;
  /** Feeds one token (see keys.ts) and adds it to the trail, also when the engine throws on it. */
  feed(token: string): void;
  snapshot(): Snapshot;
  /** The initial state, then one step per fed token. */
  trail(): readonly Step[];
  /** True when the `:` or `/` command line is open. */
  inPrompt(): boolean;
  /** True in Normal mode with no partly typed command (no count, operator or register). */
  idle(): boolean;
  destroy(): void;
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

// The codemirror-vim objects are untyped JS (CM5-style API); keep the `any` in one place.
/* eslint-disable @typescript-eslint/no-explicit-any */
type CM = any;

export interface SessionOptions {
  /** Extra extensions, e.g. the browser's theme and input guard. */
  extensions?: Extension[];
  /** Called inside every `feed`, before the key is handled (the browser opens its input guard here). */
  wrapFeed?: (run: () => void) => void;
}

export function createSession(
  m: EngineModules,
  parent: HTMLElement,
  initial: InitialState,
  options: SessionOptions = {},
): Session {
  const { EditorState } = m.state;
  const { EditorView } = m.view;
  const { vim, Vim, getCM } = m.vim;
  const win = parent.ownerDocument.defaultView!;

  (Vim as any).resetVimGlobalState_();
  applyVimProfile(Vim);

  // Undo and redo of the current key, seen in the transactions the history dispatches.
  let move: HistoryMove;
  const historyMoves = EditorView.updateListener.of((update) => {
    for (const tr of update.transactions) {
      if (tr.isUserEvent('undo')) move = 'undo';
      else if (tr.isUserEvent('redo')) move = 'redo';
    }
  });

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initial.lines.join('\n'),
      extensions: [vim(), ...editorProfileExtensions(m), historyMoves, ...(options.extensions ?? [])],
    }),
  });
  const cm: CM = getCM(view);
  // The adapter moves j/k by measured pixels (EditorView.moveVertically), which depends on fonts
  // and does not exist in jsdom. Move by buffer lines and let vim-core keep the column.
  // Screen-relative motions (H, M, L, <C-d>, gj, zt, …) stay unsupported.
  cm.findPosV = (start: { line: number; ch: number }, amount: number, unit: string) => {
    if (unit !== 'line') throw new Error(`screen-relative motion is not supported (${unit})`);
    const target = Math.min(Math.max(start.line + amount, cm.firstLine()), cm.lastLine());
    return { line: target, ch: start.ch };
  };
  const wrap = options.wrapFeed ?? ((run: () => void) => run());
  const [line, col] = initial.cursor;
  wrap(() => cm.setCursor({ line: line - 1, ch: toCh(initial.lines[line - 1] ?? '', col) }));
  // Snapshots share one lines array while the document is unchanged (CodeMirror's Text is
  // immutable), so a long trail costs memory per edit, not per key.
  let linesDoc = view.state.doc;
  let lines = linesDoc.toString().split('\n');
  const currentLines = () => {
    if (view.state.doc !== linesDoc) {
      linesDoc = view.state.doc;
      lines = linesDoc.toString().split('\n');
    }
    return lines;
  };
  const trail: Step[] = [{ snapshot: snapshotOf(cm, Vim, currentLines()) }];

  function insertText(text: string) {
    view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.type', scrollIntoView: true });
  }

  function promptKey(input: HTMLInputElement, type: 'keydown' | 'keyup', init: ReturnType<typeof keyInit>) {
    const e = new win.KeyboardEvent(type, { ...init, bubbles: true, cancelable: true });
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
        input.dispatchEvent(new win.Event('input', { bubbles: true }));
      } else if (token !== '<CR>' && token !== '<Esc>') {
        const text = tokenText(token);
        if (text !== undefined) {
          input.value += text;
          input.dispatchEvent(new win.Event('input', { bubbles: true }));
        }
      }
    }
    if (promptInput(cm) === input) promptKey(input, 'keyup', init);
  }

  function feedKey(token: string) {
    const input = promptInput(cm);
    if (input) return feedPrompt(input, token);
    const init = keyInit(token);
    const event = { ...init, code: '', preventDefault() {}, stopPropagation() {} };
    const handled = cm.state.vimPlugin.handleKey(event, view);
    if (handled || !cm.state.vim.insertMode) return;
    // Not consumed by vim in Insert mode: what a plain text field does with the key.
    if (token === '<BS>') m.commands.deleteCharBackward(view);
    else if (token === '<Del>') m.commands.deleteCharForward(view);
    else {
      const text = tokenText(token);
      if (text !== undefined) insertText(text);
    }
  }

  return {
    view,
    feed(token) {
      move = undefined;
      try {
        wrap(() => feedKey(token));
      } finally {
        const snapshot = snapshotOf(cm, Vim, currentLines());
        const change = classifyChange(trail[trail.length - 1]!.snapshot.lines, snapshot.lines, move);
        trail.push(change ? { token, change, snapshot } : { token, snapshot });
      }
    },
    snapshot() {
      return snapshotOf(cm, Vim, currentLines());
    },
    trail: () => trail,
    inPrompt() {
      return promptInput(cm) !== null;
    },
    idle() {
      const vs = cm.state.vim;
      return !vs.insertMode && !vs.visualMode && !promptInput(cm) && !vs.inputState?.keyBuffer?.length
        && !vs.inputState?.operator && !vs.inputState?.prefixRepeat?.length && !vs.inputState?.registerName;
    },
    destroy() {
      view.destroy();
    },
  };
}

/** The `:` or `/` command line, if open. Notifications also use `state.dialog` but have no input. */
function promptInput(cm: CM): HTMLInputElement | null {
  return (cm.state.dialog as HTMLElement | null)?.querySelector('input') ?? null;
}

function toPos(cm: CM, p: { line: number; ch: number }): Pos {
  return [p.line + 1, toCol(cm.getLine(p.line) ?? '', p.ch)];
}

function snapshotOf(cm: CM, Vim: any, lines: string[]): Snapshot {
  const vs = cm.state.vim;
  let mode: Mode = 'normal';
  if (promptInput(cm)) mode = 'cmdline';
  else if (vs.insertMode) mode = cm.state.overwrite ? 'replace' : 'insert';
  else if (vs.visualMode) mode = vs.visualBlock ? 'visual-block' : vs.visualLine ? 'visual-line' : 'visual';

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
