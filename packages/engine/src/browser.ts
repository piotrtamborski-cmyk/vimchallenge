/**
 * The editor in the browser. Every change to the buffer goes through `Session.feed`, the same
 * function the judge replays, so the key log recorded here reproduces the final state on the
 * server. Everything else that could change the editor behind Vim's back — mouse clicks, drag
 * and drop, native text input, losing focus with the command line open — is either turned into
 * tokens or blocked.
 */
import * as commands from '@codemirror/commands';
import * as language from '@codemirror/language';
import * as state from '@codemirror/state';
import * as view from '@codemirror/view';
import * as vim from '@replit/codemirror-vim';
import { decideKey, textTokens } from './browser-keys.ts';
import { createSession, type EngineModules } from './session.ts';
import type { InitialState, Snapshot, Step } from './types.ts';

const modules: EngineModules = { state, view, commands, language, vim };

export interface EditorOptions {
  initial: InitialState;
  /** Accept pasted text in Insert mode and on the command line (training). Default true. */
  allowPaste?: boolean;
  autofocus?: boolean;
  /** After every key the engine handled. */
  onKey?: (step: Step) => void;
  /** Alt+Enter: submit in the current mode, e.g. with an active selection. */
  onSubmit?: (trail: readonly Step[]) => void;
  /** Input the editor refused or the engine could not handle. */
  onRejected?: (message: string) => void;
}

export interface BrowserEditor {
  snapshot(): Snapshot;
  /** Every token fed so far, in order. */
  log(): readonly string[];
  /** The initial state, then the state after every key and what the key did (see `checkGoals`). */
  trail(): readonly Step[];
  focus(): void;
  destroy(): void;
}

let mounted: BrowserEditor | undefined;

export function mountEditor(parent: HTMLElement, options: EditorOptions): BrowserEditor {
  // vim-core state is global: one live editor per page.
  mounted?.destroy();
  const log: string[] = [];
  let feeding = 0;
  const allowPaste = options.allowPaste ?? true;

  // Drop every change to text or cursor that does not come from `feed`.
  const guard = state.EditorState.transactionFilter.of((tr) =>
    feeding || (!tr.docChanged && !tr.selection) ? tr : {},
  );

  const session = createSession(modules, parent, options.initial, {
    extensions: [
      guard,
      view.lineNumbers(),
      view.drawSelection(),
      view.highlightActiveLine(),
      view.EditorView.contentAttributes.of({
        'aria-label': 'Vim editor',
        spellcheck: 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
      }),
    ],
    wrapFeed(run) {
      feeding++;
      try {
        run();
      } finally {
        feeding--;
      }
    },
  });
  const dom = session.view.dom;

  function feed(token: string) {
    log.push(token);
    try {
      session.feed(token);
    } catch (err) {
      // The judge replays the same token and hits the same error, so the log stays valid.
      options.onRejected?.(`${token}: ${(err as Error).message}`);
    }
    const trail = session.trail();
    options.onKey?.(trail[trail.length - 1]!);
  }

  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };

  function onKeydown(e: KeyboardEvent) {
    // Our own events into the command line input (see session.ts) must reach it.
    if (!e.isTrusted) return;
    // IME and dead keys: the text arrives as `beforeinput` (handled below).
    if (e.isComposing || e.keyCode === 229 || e.key === 'Dead' || e.key === 'Process' || e.key === 'Unidentified') return;
    if (e.key === 'Enter' && e.altKey && !e.ctrlKey && !e.metaKey) {
      stop(e);
      options.onSubmit?.(session.trail());
      return;
    }
    const decision = decideKey(e);
    if (decision.kind === 'pass') {
      // The browser does its default; Vim must not see the key.
      e.stopPropagation();
      return;
    }
    if (decision.kind === 'token' && decision.token === '<Tab>' && session.idle()) {
      // Esc, Tab leaves the editor (documented, keyboard-only navigation).
      e.stopPropagation();
      return;
    }
    stop(e);
    if (decision.kind === 'unsupported') options.onRejected?.(`${decision.name} is not supported`);
    else feed(decision.token);
  }

  function onBeforeInput(e: InputEvent) {
    // Composition text cannot be cancelled; the guard drops it and CodeMirror restores the DOM.
    if (e.inputType === 'insertCompositionText') return;
    stop(e);
    if (e.inputType === 'insertText' && e.data) for (const t of textTokens(e.data)) feed(t);
    else if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') feed('<CR>');
    else if (e.inputType === 'deleteContentBackward') feed('<BS>');
    else if (e.inputType === 'deleteContentForward') feed('<Del>');
    else options.onRejected?.(`${e.inputType} is not supported`);
  }

  function onPaste(e: ClipboardEvent) {
    stop(e);
    const mode = session.snapshot().mode;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!allowPaste) options.onRejected?.('Pasting is turned off here');
    else if (mode !== 'insert' && mode !== 'replace' && mode !== 'cmdline') options.onRejected?.('Paste in Insert mode');
    else for (const t of textTokens(text)) feed(t);
  }

  function focusTarget() {
    const input = dom.querySelector<HTMLInputElement>('.cm-panels input');
    if (input && session.inPrompt()) input.focus();
    else session.view.focus();
  }

  function onPointer(e: Event) {
    // Clicking only focuses: moving the cursor with the mouse is not part of the game.
    stop(e);
    focusTarget();
  }

  function onFocusOut(e: FocusEvent) {
    // The engine itself blurs the command line when Enter or Esc closes it.
    if (feeding) return;
    const next = e.relatedTarget as Node | null;
    if (next && dom.contains(next)) return;
    // The command line closes when it loses focus; record that as the Esc it amounts to.
    if (session.inPrompt()) feed('<Esc>');
  }

  const refuse = (e: Event) => stop(e);
  const listeners: [string, (e: never) => void][] = [
    ['keydown', onKeydown],
    ['beforeinput', onBeforeInput],
    ['paste', onPaste],
    ['cut', refuse],
    ['drop', refuse],
    ['dragstart', refuse],
    ['mousedown', onPointer],
    ['focusout', onFocusOut],
  ];
  for (const [type, fn] of listeners) dom.addEventListener(type, fn as EventListener, true);

  if (options.autofocus ?? true) session.view.focus();

  const editor: BrowserEditor = {
    snapshot: () => session.snapshot(),
    log: () => log,
    trail: () => session.trail(),
    focus: focusTarget,
    destroy() {
      for (const [type, fn] of listeners) dom.removeEventListener(type, fn as EventListener, true);
      session.destroy();
      if (mounted === editor) mounted = undefined;
    },
  };
  mounted = editor;
  return editor;
}
