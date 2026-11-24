import { describe, expect, it } from 'vitest';
import { parseKeys, tokenText } from '../src/keys.ts';
import { toCh, toCol } from '../src/positions.ts';

describe('parseKeys', () => {
  it('splits plain keys and special keys', () => {
    expect(parseKeys('ciwnowy<Esc>')).toEqual(['c', 'i', 'w', 'n', 'o', 'w', 'y', '<Esc>']);
    expect(parseKeys('"ayiw')).toEqual(['"', 'a', 'y', 'i', 'w']);
  });
  it('normalises control keys and spaces', () => {
    expect(parseKeys('<C-V>2jI# <Esc>')).toEqual(['<C-v>', '2', 'j', 'I', '#', '<Space>', '<Esc>']);
    expect(parseKeys('<lt>')).toEqual(['<']);
  });
  it('keeps Vim regex atoms literal', () => {
    expect(parseKeys(':s/\\<id\\>/k/<CR>').join('')).toBe(':s/\\<id\\>/k/<CR>');
  });
  it('keeps code points whole', () => {
    expect(parseKeys('rą😀')).toEqual(['r', 'ą', '😀']);
  });
  it('maps tokens to typed text', () => {
    expect(tokenText('<Space>')).toBe(' ');
    expect(tokenText('<Esc>')).toBeUndefined();
    expect(tokenText('ż')).toBe('ż');
  });
});

describe('columns', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(toCol('a😀b', 3)).toBe(3); // after 'a' and the emoji
    expect(toCh('a😀b', 3)).toBe(3);
    expect(toCol('gęś', 3)).toBe(4);
  });
  it('allows the insert position after the last character', () => {
    expect(toCol('abc', 3)).toBe(4);
  });
});
