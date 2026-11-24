/** 1-based position; `col` counts Unicode code points in the line. */
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
