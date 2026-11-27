/**
 * Filling in messages. A message is a string with `{name}` places, or a plural: one string per
 * CLDR plural category (`one`, `few`, `many`, `other`…), picked by `{n}` with `Intl.PluralRules`.
 * Rich messages also have `<tag>…</tag>` parts, which the page turns into links (see rich.tsx).
 */
import { intlLocale } from './locales.ts';

export interface Plural {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Message = string | Plural;
export type Values = Record<string, string | number>;

export const isPlural = (m: Message): m is Plural => typeof m === 'object';

/** The plural form for `n` in this language, falling back to `other`. */
export function pluralForm(lang: string, m: Plural, n: number): string {
  const category = new Intl.PluralRules(intlLocale(lang)).select(n) as keyof Plural;
  return m[category] ?? m.other;
}

/** A number as the language writes it: `12.5` → `12,5` in Polish. */
export const formatNumber = (lang: string, n: number, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(intlLocale(lang), options).format(n);

/** The message as a string, places filled. Numbers are written the language's way. */
export function fill(lang: string, m: Message, values: Values = {}): string {
  const text = isPlural(m) ? pluralForm(lang, m, Number(values.n ?? 0)) : m;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => {
    const v = values[name];
    if (v === undefined) return all;
    return typeof v === 'number' ? formatNumber(lang, v) : v;
  });
}

/** Seconds with one decimal, e.g. `12.5 s` (`12,5 s` in most languages). */
export const formatSeconds = (lang: string, ms: number) =>
  `${formatNumber(lang, ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;

/** A day of the challenge (`2026-11-27`) as the language writes a date. */
export function formatDay(lang: string, day: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }): string {
  return new Intl.DateTimeFormat(intlLocale(lang), { ...options, timeZone: 'UTC' }).format(Date.parse(`${day}T00:00:00Z`));
}

/** A moment, with date and time, in UTC: for lists of past events. */
export const formatUtc = (lang: string, ms: number) =>
  new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(ms) + ' UTC';

/** `A, B and C` (or `A, B or C` with `type: 'disjunction'`). */
export const formatList = (lang: string, items: string[], type: 'conjunction' | 'disjunction' = 'conjunction') =>
  new Intl.ListFormat(intlLocale(lang), { style: 'long', type }).format(items);

/**
 * The made-up development language: letters accented, the message a third longer and in
 * brackets. `{places}`, `<tags>` and `code` in backticks stay as they are.
 */
export function pseudo(text: string): string {
  const map: Record<string, string> = {
    a: 'á', e: 'é', i: 'î', o: 'ö', u: 'ü', c: 'ç', n: 'ñ', s: 'š', y: 'ý', z: 'ž',
    A: 'Á', E: 'É', I: 'Î', O: 'Ö', U: 'Ü', C: 'Ç', N: 'Ñ', S: 'Š', Y: 'Ý', Z: 'Ž',
  };
  const parts = text.split(/(\{\w+\}|<\/?\w+>|`[^`]*`)/);
  const out = parts.map((p, i) => (i % 2 ? p : p.replace(/[a-zA-Z]/g, (c) => map[c] ?? c))).join('');
  const letters = text.replace(/\{\w+\}|<\/?\w+>|`[^`]*`/g, '').length;
  return `⟦${out}${'·'.repeat(Math.ceil(letters / 3))}⟧`;
}
