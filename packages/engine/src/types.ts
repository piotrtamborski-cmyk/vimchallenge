/** 1-based position; `col` counts characters like Vim's charcol(): code points, combining marks included in the preceding character. */
export type Pos = [line: number, col: number];

export type Mode =
  | 'normal'
  | 'insert'
  | 'replace'
  | 'visual'
  | 'visual-line'
  | 'visual-block'
  | 'cmdline'
  | `other:${string}`;

export interface RegisterValue {
  type: 'char' | 'line' | 'block';
  text: string;
}

/** Observable editor state, shared by the browser engine, the judge and reference Vim. */
export interface Snapshot {
  lines: string[];
  mode: Mode;
  cursor: Pos;
  visual?: { anchor: Pos; head: Pos };
  registers: Record<string, RegisterValue>;
  marks: Record<string, Pos>;
}

export interface InitialState {
  lines: string[];
  cursor: Pos;
}

/**
 * What one key did to the text: an ordinary edit, or a move through the undo history. `undo` and
 * `redo` count even when the text stays the same (undoing `r` with the same letter).
 */
export type Change = 'edit' | 'undo' | 'redo';

/** One entry of a trail: the state after a key and what the key did. */
export interface Step {
  /** The key; absent on the first entry, which is the initial state. */
  token?: string;
  change?: Change;
  snapshot: Snapshot;
}

/** Undo or redo reported by an engine for one key; `classifyChange` turns it into a `Change`. */
export type HistoryMove = 'undo' | 'redo' | undefined;
