/**
 * Vim-style undo steps on top of CodeMirror's history.
 *
 * CodeMirror groups history events by time (newGroupDelay) and event type, so in the browser the
 * result of `u` would depend on typing speed, and an instant replay by the judge would differ.
 * Vim's rule is simpler: one Normal-mode command, including everything typed in the Insert mode
 * it starts, is one undo step; so is a whole macro or `.` repeat.
 *
 * Every key handled outside Insert mode starts a new "Vim change". Each history event CodeMirror
 * records is tagged with the change that produced it, and `u` / CTRL-R undo or redo all events of
 * the last change together, however CodeMirror happened to group them.
 */
import type { Extension, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

type Mods = {
  state: typeof import('@codemirror/state');
  view: typeof import('@codemirror/view');
  commands: typeof import('@codemirror/commands');
  vim: typeof import('@replit/codemirror-vim');
};

interface Tracker {
  /** Id of the Vim change that new edits belong to. */
  current: number;
  /** Id of the change whose edits last went into the history. */
  lastEdited: number;
  /** One entry per CodeMirror history event, oldest first. */
  done: number[];
  /** Undone groups, most recent last; each entry lists the ids of the events in that group. */
  undone: number[][];
  /** Cursor before each Vim change (Vim's uh_cursor), for placing the cursor after undo/redo. */
  before: Map<number, { line: number; ch: number }>;
}

const trackers = new WeakMap<EditorView, Tracker>();
let installed = false;

/* eslint-disable @typescript-eslint/no-explicit-any */
function install(m: Mods): void {
  if (installed) return;
  installed = true;
  const { Vim, CodeMirror } = m.vim as any;

  // A key typed outside Insert mode starts a new Vim change.
  const handleKey = Vim.multiSelectHandleKey;
  Vim.multiSelectHandleKey = function (cm: any, key: string, origin: string) {
    const tracker = trackers.get(cm.cm6);
    if (tracker && origin === 'user' && !cm.state.vim?.insertMode) {
      tracker.current++;
      tracker.before.set(tracker.current, cm.getCursor());
      if (tracker.before.size > 2000) tracker.before.delete(tracker.before.keys().next().value!);
    }
    return handleKey.apply(this, arguments as any);
  };

  const undo = CodeMirror.commands.undo;
  const redo = CodeMirror.commands.redo;
  CodeMirror.commands.undo = function (cm: any) {
    const tracker = trackers.get(cm.cm6);
    if (!tracker || !tracker.done.length) return undo(cm);
    const id = tracker.done[tracker.done.length - 1];
    const group: number[] = [];
    const start = new ChangeStart(cm);
    while (tracker.done.length && tracker.done[tracker.done.length - 1] === id) {
      group.push(tracker.done.pop()!);
      undo(cm);
      start.record();
    }
    start.apply(tracker.before.get(id!));
    tracker.undone.push(group);
  };
  CodeMirror.commands.redo = function (cm: any) {
    const tracker = trackers.get(cm.cm6);
    if (!tracker || !tracker.undone.length) return redo(cm);
    const group = tracker.undone.pop()!;
    const start = new ChangeStart(cm);
    for (const id of group.reverse()) {
      tracker.done.push(id);
      redo(cm);
      start.record();
    }
    start.apply(tracker.before.get(group[0]!));
  };
}

/**
 * Cursor after undo/redo, as observed in Vim: the cursor from before the change when it was on
 * (or next to) the first changed line — e.g. the line where `o` or `O` was typed — otherwise
 * the first non-blank of the first changed line. The adapter only knows the start of one history step, so the
 * earliest start of all steps of the change is used.
 */
class ChangeStart {
  private min: number | undefined;
  private cm: any;
  constructor(cm: any) {
    this.cm = cm;
  }
  record() {
    const start = this.cm.curOp?.$changeStart;
    if (typeof start === 'number') this.min = this.min === undefined ? start : Math.min(this.min, start);
  }
  apply(before: { line: number; ch: number } | undefined) {
    if (this.min === undefined) return;
    const first = this.cm.posFromIndex(this.min);
    let target: number;
    if (before && Math.abs(before.line - first.line) <= 1 && before.line <= this.cm.lastLine()) {
      target = this.cm.indexFromPos(before);
    } else {
      // Otherwise Vim goes to the first non-blank of the first changed line.
      const text: string = this.cm.getLine(first.line);
      target = this.cm.indexFromPos({ line: first.line, ch: Math.max(0, text.search(/\S|$/)) });
    }
    this.cm.cm6.dispatch({ selection: { anchor: target } });
  }
}

const isHistoryReplay = (tr: Transaction) => tr.isUserEvent('undo') || tr.isUserEvent('redo');

export function vimUndoSteps(m: Mods): Extension[] {
  install(m);
  const { undoDepth, isolateHistory } = m.commands;
  let tracker: Tracker | undefined;
  return [
    m.view.ViewPlugin.define((view) => {
      tracker = { current: 0, lastEdited: -1, done: [], undone: [], before: new Map() };
      trackers.set(view, tracker);
      return {
        update(update) {
          const t = trackers.get(view);
          if (!t) return;
          for (const tr of update.transactions) {
            if (tr.changes.empty || isHistoryReplay(tr)) continue;
            if (undoDepth(tr.state) > undoDepth(tr.startState)) {
              t.done.push(t.lastEdited);
              t.undone = [];
            }
          }
        },
        destroy() {
          trackers.delete(view);
        },
      };
    }),
    // Never let CodeMirror merge edits of two different Vim changes into one history event.
    m.state.EditorState.transactionExtender.of((tr: Transaction) => {
      if (!tracker || tr.changes.empty || isHistoryReplay(tr)) return null;
      const isNew = tracker.current !== tracker.lastEdited;
      tracker.lastEdited = tracker.current;
      return isNew ? { annotations: isolateHistory.of('before') } : null;
    }),
  ];
}

