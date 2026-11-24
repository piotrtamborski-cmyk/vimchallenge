import type { Pos } from './types.ts';

/**
 * Columns count characters the way Vim's charcol() does: one per code point, except that
 * combining marks belong to the character before them ("é" written as e + U+0301 is one column).
 * Task material is NFC, so this only matters for decomposed text.
 */
const COMBINING = /\p{M}/u;

function stepFrom(text: string, i: number): number {
  i += text.codePointAt(i)! > 0xffff ? 2 : 1;
  while (i < text.length && COMBINING.test(String.fromCodePoint(text.codePointAt(i)!))) {
    i += text.codePointAt(i)! > 0xffff ? 2 : 1;
  }
  return i;
}

/** Converts a 0-based UTF-16 offset in a line to a 1-based column. */
export function toCol(lineText: string, ch: number): number {
  let col = 1;
  let i = 0;
  while (i < lineText.length) {
    const next = stepFrom(lineText, i);
    if (next > ch) break;
    i = next;
    col++;
  }
  // Past the end of the line (insert mode at end of line).
  return col + Math.max(0, ch - lineText.length);
}

/** Converts a 1-based column to a 0-based UTF-16 offset in a line. */
export function toCh(lineText: string, col: number): number {
  let ch = 0;
  for (let c = 1; c < col && ch < lineText.length; c++) ch = stepFrom(lineText, ch);
  return ch;
}

export function pos(line: number, col: number): Pos {
  return [line, col];
}
