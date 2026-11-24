import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module without declarations
import { compileVimReplacement, escapeVimPattern, translateVimPattern } from '../regex.js';

const js = (p: string) => new RegExp(translateVimPattern(p).source, 'mu');
const first = (p: string, text: string) => text.match(js(p))?.[0] ?? null;

describe('translateVimPattern', () => {
  it('magic quantifiers and groups', () => {
    expect(first('a\\+', 'baaa')).toBe('aaa');
    expect(first('ab\\=c', 'ac')).toBe('ac');
    expect(first('a\\{2}', 'aaa')).toBe('aa');
    expect(first('a\\{,2}', 'aaa')).toBe('aa');
    expect(first('a\\{-1,}', 'aaa')).toBe('a');
    expect(first('\\(ab\\)\\+', 'ababc')).toBe('abab');
    expect(first('\\%(ab\\)\\+', 'ababc')).toBe('abab');
    expect(first('a\\|b', 'xb')).toBe('b');
  });
  it('literal characters that are special in JavaScript', () => {
    expect(first('(bad)', 'lhs=(bad)')).toBe('(bad)');
    expect(first('a+b?', 'a+b?')).toBe('a+b?');
    expect(first('x{1}', 'x{1}')).toBe('x{1}');
    expect(first('a\\/b', 'a/b')).toBe('a/b');
    expect(first('a^b', 'a^b')).toBe('a^b');
    expect(first('a$b', 'a$b')).toBe('a$b');
    expect(first('\\.', 'a.b')).toBe('.');
  });
  it('anchors only where Vim treats them as anchors', () => {
    expect(first('^ab', 'ab')).toBe('ab');
    expect(first('ab$', 'xab')).toBe('ab');
    expect(first('\\(^a\\|b$\\)', 'b')).toBe('b');
  });
  it('word boundaries and keyword class include Polish letters', () => {
    expect('że że działa'.replace(new RegExp(translateVimPattern('\\<że\\>').source, 'gmu'), 'to')).toBe('to to działa');
    expect(first('\\<\\(\\k\\+\\)\\s\\+\\1\\>', 'że że działa')).toBe('że że');
    expect(first('\\<id\\>', 'id2 id')).toBe('id');
  });
  it('classes never match the end of a line unless \\_ or \\n is used', () => {
    expect(translateVimPattern('\\s\\+$').source).not.toMatch(/\\s/);
    expect(first('[^x]\\+', 'ab\ncd')).toBe('ab');
    expect(first('\\S\\+', 'ab\ncd')).toBe('ab');
    expect(first('a\\_sb', 'a\nb')).toBe('a\nb');
    expect(first('a\\nb', 'a\nb')).toBe('a\nb');
  });
  it('bracket expressions', () => {
    expect(first('[[:digit:]]\\+', 'ab12')).toBe('12');
    expect(first('[]x]', ']')).toBe(']');
    expect(first('[a-c]\\+', 'xabcd')).toBe('abc');
    expect(first('[', 'a[b')).toBe('[');
  });
  it('very magic, nomagic and very nomagic', () => {
    expect(first('\\v(\\w+)-(\\w+)', 'ab-cd')).toBe('ab-cd');
    expect(first('\\v<id>', 'id2 id')).toBe('id');
    expect(first('\\Vx.y', 'xay x.y')).toBe('x.y');
    expect(first('\\Mx.y', 'xay x.y')).toBe('x.y');
  });
  it('\\zs, \\ze and lookarounds', () => {
    expect(first('foo\\zsbar', 'foobar')).toBe('bar');
    expect(first('foo\\zebar', 'foobar')).toBe('foo');
    expect(first('\\(\\d\\+\\)\\@<=px', '10px')).toBe('px');
    expect(first('a\\(b\\)\\@!', 'ab ac')).toBe('a');
  });
  it('case flags', () => {
    expect(translateVimPattern('\\ckot').ignoreCase).toBe(true);
    expect(translateVimPattern('kot\\C').ignoreCase).toBe(false);
    expect(translateVimPattern('kot').ignoreCase).toBeUndefined();
  });
  it('rejects what it cannot translate faithfully', () => {
    expect(() => translateVimPattern('\\%V')).toThrow();
    expect(() => translateVimPattern('\\(a')).toThrow();
  });
  it('escapes literal text for * and #', () => {
    expect(first(escapeVimPattern('a.b*'), 'axb a.b*')).toBe('a.b*');
  });
});

describe('compileVimReplacement', () => {
  const run = (tpl: string, groups: string[]) => compileVimReplacement(tpl).expand(groups);
  it('whole match and groups', () => {
    expect(run('[&]', ['a'])).toBe('[a]');
    expect(run('\\&', ['a'])).toBe('&');
    expect(run('\\2 (\\1)', ['x', 'ela', 'dev'])).toBe('dev (ela)');
  });
  it('case conversion', () => {
    expect(run('\\1\\U\\2\\E', ['', 'flag_a=', 'off'])).toBe('flag_a=OFF');
    expect(run('\\u\\1', ['', 'kot'])).toBe('Kot');
    expect(run('\\L&', ['ABC'])).toBe('abc');
    expect(run('\\U\\l&', ['abc'])).toBe('aBC');
  });
  it('line break, tab and previous string', () => {
    expect(run('\\r', ['a'])).toBe('\n');
    expect(run('\\t', ['a'])).toBe('\t');
    expect(compileVimReplacement('~!', { previous: 'X' }).expand(['a'])).toBe('X!');
  });
});
