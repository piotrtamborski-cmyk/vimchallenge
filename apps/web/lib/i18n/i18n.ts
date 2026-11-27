/**
 * One language's tools, the same on the server and in the browser: the messages, filling them
 * in, and writing numbers, dates and lists the way the language does.
 */
import type { ReactNode } from 'react';
import { fill, formatDay, formatList, formatNumber, formatSeconds, formatUtc, type Message, type Values } from './format.ts';
import { localePath } from './locales.ts';
import { richText, type RichValues } from './rich.tsx';

export interface I18n<M> {
  lang: string;
  m: M;
  /** The message as a string, with its places filled (`n` picks a plural form). */
  t: (message: Message, values?: Values) => string;
  /** The message with elements in it: `<tag>` parts wrapped by functions, `{places}` filled with elements. */
  rich: (message: Message, values?: RichValues) => ReactNode;
  /** The address of a page of the site in this language. */
  href: (path: string) => string;
  number: (n: number, options?: Intl.NumberFormatOptions) => string;
  seconds: (ms: number) => string;
  day: (day: string, options?: Intl.DateTimeFormatOptions) => string;
  utc: (ms: number) => string;
  list: (items: string[], type?: 'conjunction' | 'disjunction') => string;
}

export function makeI18n<M>(lang: string, m: M): I18n<M> {
  return {
    lang,
    m,
    t: (message, values) => fill(lang, message, values),
    rich: (message, values) => richText(lang, message, values),
    href: (path) => localePath(lang, path),
    number: (n, options) => formatNumber(lang, n, options),
    seconds: (ms) => formatSeconds(lang, ms),
    day: (day, options) => formatDay(lang, day, options),
    utc: (ms) => formatUtc(lang, ms),
    list: (items, type) => formatList(lang, items, type),
  };
}
