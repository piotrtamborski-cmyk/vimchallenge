import type { Pos } from './types.ts';

/** Converts a 0-based UTF-16 offset in a line to a 1-based code point column. */
export function toCol(lineText: string, ch: number): number {
  let col = 1;
  for (let i = 0; i < ch && i < lineText.length; ) {
    i += lineText.codePointAt(i)! > 0xffff ? 2 : 1;
    col++;
  }
  // Past the end of the line (insert mode at end of line).
  return col + Math.max(0, ch - lineText.length);
}

/** Converts a 1-based code point column to a 0-based UTF-16 offset in a line. */
export function toCh(lineText: string, col: number): number {
  let ch = 0;
  for (let c = 1; c < col && ch < lineText.length; c++) {
    ch += lineText.codePointAt(ch)! > 0xffff ? 2 : 1;
  }
  return ch;
}

export function pos(line: number, col: number): Pos {
  return [line, col];
}
