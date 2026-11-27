import { describe, expect, it } from 'vitest';
import { fill, pseudo, type Message } from '../lib/i18n/format.ts';
import { localePath, negotiate, routeLang, splitLang } from '../lib/i18n/locales.ts';
import { DICTIONARIES, messagesFor } from '../lib/i18n/messages/index.ts';
import { en } from '../lib/i18n/messages/en.ts';

const LANGS = ['en', 'de', 'pl'];

describe('addresses', () => {
  it('splits and builds language prefixes', () => {
    expect(splitLang('/de/tasks/x', LANGS)).toEqual({ lang: 'de', path: '/tasks/x' });
    expect(splitLang('/de', LANGS)).toEqual({ lang: 'de', path: '/' });
    expect(splitLang('/tasks', LANGS)).toEqual({ path: '/tasks' });
    // A code that is not a language here is an ordinary path.
    expect(splitLang('/fr/tasks', LANGS)).toEqual({ path: '/fr/tasks' });
    expect(splitLang('/delete', LANGS)).toEqual({ path: '/delete' });
    expect(localePath('en', '/tasks')).toBe('/tasks');
    expect(localePath('de', '/tasks?text=2')).toBe('/de/tasks?text=2');
    expect(localePath('de', '/')).toBe('/de');
  });

  it('reads the browser’s languages with their weights', () => {
    expect(negotiate('de-AT,de;q=0.9,en;q=0.8', LANGS)).toBe('de');
    expect(negotiate('fr-FR,fr;q=0.9,pl;q=0.5,en;q=0.4', LANGS)).toBe('pl');
    expect(negotiate('en;q=0.5,pl', LANGS)).toBe('pl');
    expect(negotiate('es,fr', LANGS)).toBeUndefined();
    expect(negotiate('pl;q=0', LANGS)).toBeUndefined();
    expect(negotiate('', LANGS)).toBeUndefined();
    expect(negotiate(null, LANGS)).toBeUndefined();
  });
});

describe('which language a page gets', () => {
  const route = (path: string, cookie?: string, accept: string | null = null) => routeLang(path, cookie, accept, LANGS);

  it('serves an address without a prefix in English when nothing says otherwise', () => {
    expect(route('/tasks')).toEqual({ kind: 'page', lang: 'en' });
    expect(route('/')).toEqual({ kind: 'page', lang: 'en' });
    expect(route('/tasks', undefined, 'es,en;q=0.5')).toEqual({ kind: 'page', lang: 'en' });
  });

  it('follows the browser on the first visit, and remembers it', () => {
    expect(route('/tasks', undefined, 'pl-PL,pl;q=0.9')).toEqual({ kind: 'redirect', to: '/pl/tasks', setCookie: 'pl', auto: true });
    expect(route('/', undefined, 'de')).toEqual({ kind: 'redirect', to: '/de', setCookie: 'de', auto: true });
  });

  it('prefers the remembered language to the browser’s', () => {
    expect(route('/tasks', 'de', 'pl')).toEqual({ kind: 'redirect', to: '/de/tasks' });
    expect(route('/tasks', 'en', 'pl')).toEqual({ kind: 'page', lang: 'en' });
    // A remembered language that is no longer offered is ignored.
    expect(route('/tasks', 'fr', 'pl')).toEqual({ kind: 'redirect', to: '/pl/tasks', setCookie: 'pl', auto: true });
  });

  it('never redirects an address with a language: it wins and is remembered', () => {
    expect(route('/de/tasks', 'pl', 'pl')).toEqual({ kind: 'page', lang: 'de', setCookie: 'de' });
    expect(route('/de/tasks', 'de')).toEqual({ kind: 'page', lang: 'de', setCookie: undefined });
  });

  it('sends /en/… to the address without a prefix, which is how a player switches back to English', () => {
    expect(route('/en/tasks', 'de')).toEqual({ kind: 'redirect', to: '/tasks', setCookie: 'en' });
    expect(route('/en', 'de')).toEqual({ kind: 'redirect', to: '/', setCookie: 'en' });
  });
});

describe('messages', () => {
  it('fills places and picks plural forms the language’s way', () => {
    expect(fill('en', 'Solved in {time}.', { time: '1.5 s' })).toBe('Solved in 1.5 s.');
    expect(fill('en', en.common.keys, { n: 1 })).toBe('1 key');
    expect(fill('en', en.common.keys, { n: 3 })).toBe('3 keys');
    expect(fill('en', en.common.keys, { n: 1234 })).toBe('1,234 keys');
    const keys: Message = { one: '{n} klawisz', few: '{n} klawisze', many: '{n} klawiszy', other: '{n} klawisza' };
    expect([1, 2, 5, 22, 25].map((n) => fill('pl', keys, { n }))).toEqual(['1 klawisz', '2 klawisze', '5 klawiszy', '22 klawisze', '25 klawiszy']);
    expect(fill('pl', '{n} s', { n: 12.5 })).toBe('12,5 s');
  });

  it('keeps places, tags and Vim notation in the pseudo language', () => {
    expect(pseudo('Press `<Esc>` in {mode} <link>now</link>')).toMatch(/^⟦Pr[^`]*`<Esc>`[^{]*\{mode\} <link>[^<]*<\/link>·+⟧$/);
  });

  /** Places (`{n}`), tags (`<link>`) and code in backticks of a message. */
  const shape = (text: string) => [...text.matchAll(/\{\w+\}|<\/?\w+>|`[^`]*`/g)].map((m) => m[0]).sort();
  const texts = (value: unknown, path = ''): [string, string][] =>
    typeof value === 'string' ? [[path, value]] : Object.entries(value as object).flatMap(([k, v]) => texts(v, path ? `${path}.${k}` : k));

  it('has every message of English, with the same places, tags and code, in every language', () => {
    const english = new Map(texts(en));
    const plural = (path: string) => /\.(zero|one|two|few|many|other)$/.test(path);
    for (const [lang, messages] of Object.entries({ ...DICTIONARIES, xx: messagesFor('xx') })) {
      const translated = new Map(texts(messages));
      for (const [path, text] of english) {
        if (plural(path)) continue;
        expect(translated.has(path), `${lang}: ${path} is missing`).toBe(true);
        expect(shape(translated.get(path)!), `${lang}: ${path}`).toEqual(shape(text));
      }
      // Plural forms: each form has the places of English's `other` (a form may leave out `{n}`).
      for (const [path, text] of translated) {
        if (!plural(path)) continue;
        const other = english.get(path.replace(/\.\w+$/, '.other'))!;
        const extra = shape(text).filter((p) => p !== '{n}' && !shape(other).includes(p));
        expect(extra, `${lang}: ${path}`).toEqual([]);
      }
    }
  });
});
