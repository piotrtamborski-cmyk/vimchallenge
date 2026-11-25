import { describe, expect, it } from 'vitest';
import { decideKey, textTokens, type KeyLike } from '../src/browser-keys.ts';
import { isToken } from '../src/keys.ts';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k, code: '', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...mods,
});
const token = (t: string) => ({ kind: 'token', token: t });

describe('decideKey', () => {
  it('maps characters and named keys to tokens', () => {
    expect(decideKey(key('x'))).toEqual(token('x'));
    expect(decideKey(key('X', { shiftKey: true }))).toEqual(token('X'));
    expect(decideKey(key(' '))).toEqual(token('<Space>'));
    expect(decideKey(key('<', { shiftKey: true }))).toEqual(token('<'));
    expect(decideKey(key('ą'))).toEqual(token('ą'));
    expect(decideKey(key('Escape'))).toEqual(token('<Esc>'));
    expect(decideKey(key('Enter'))).toEqual(token('<CR>'));
    expect(decideKey(key('ArrowLeft'))).toEqual(token('<Left>'));
  });

  it('maps Ctrl keys, following the physical key on non-Latin layouts', () => {
    expect(decideKey(key('v', { ctrlKey: true }))).toEqual(token('<C-v>'));
    expect(decideKey(key('V', { ctrlKey: true }))).toEqual(token('<C-v>'));
    expect(decideKey(key('м', { ctrlKey: true, code: 'KeyV' }))).toEqual(token('<C-v>'));
    expect(decideKey(key('[', { ctrlKey: true }))).toEqual(token('<C-[>'));
  });

  it('treats AltGr (Ctrl+Alt on Windows) as the character it produces', () => {
    expect(decideKey(key('ą', { ctrlKey: true, altKey: true }))).toEqual(token('ą'));
  });

  it('leaves browser shortcuts and focus keys to the browser', () => {
    expect(decideKey(key('I', { ctrlKey: true, shiftKey: true }))).toEqual({ kind: 'pass' });
    expect(decideKey(key('Tab', { ctrlKey: true }))).toEqual({ kind: 'pass' });
    expect(decideKey(key('Tab', { shiftKey: true }))).toEqual({ kind: 'pass' });
    expect(decideKey(key('c', { metaKey: true }))).toEqual({ kind: 'pass' });
    expect(decideKey(key('x', { altKey: true }))).toEqual({ kind: 'pass' });
    expect(decideKey(key('F5'))).toEqual({ kind: 'pass' });
    expect(decideKey(key('Shift', { shiftKey: true }))).toEqual({ kind: 'pass' });
  });

  it('refuses keys the judge cannot replay', () => {
    expect(decideKey(key('Home'))).toEqual({ kind: 'unsupported', name: 'Home' });
    expect(decideKey(key('ArrowRight', { shiftKey: true }))).toEqual({ kind: 'unsupported', name: 'Shift+ArrowRight' });
  });
});

describe('textTokens', () => {
  it('turns text into typed tokens', () => {
    expect(textTokens('a b\r\nć\t')).toEqual(['a', '<Space>', 'b', '<CR>', 'ć', '<Tab>']);
  });
  it('drops control characters the judge would refuse', () => {
    expect(textTokens('a\u0000b\u000bc\u0085')).toEqual(['a', 'b', 'c']);
  });
});

describe('the judge accepts every token the browser logs', () => {
  it('for keys', () => {
    const keys = [
      key('x'), key('ą'), key('😀'), key(' '), key('Escape'), key('Enter'), key('Backspace'), key('Tab'),
      key('Delete'), key('ArrowLeft'), key('v', { ctrlKey: true }), key('V', { ctrlKey: true }), key('[', { ctrlKey: true }),
      key('ф', { ctrlKey: true, code: 'KeyA' }), key('ą', { ctrlKey: true, altKey: true }),
    ];
    for (const k of keys) {
      const d = decideKey(k);
      expect(d.kind === 'token' && isToken(d.token), `${k.key}`).toBe(true);
    }
  });
  it('for text', () => {
    expect(textTokens('Zażółć gęślą jaźń!\r\n\t<>').every(isToken)).toBe(true);
  });
});
