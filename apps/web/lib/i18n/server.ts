/** The language of a page on the server, from the `[lang]` segment of its address. */
import { notFound } from 'next/navigation';
import { makeI18n, type I18n } from './i18n.ts';
import { isLang } from './locales.ts';
import { messagesFor, type Messages } from './messages/index.ts';

export type ServerI18n = I18n<Messages>;

/** The tools for the page's language; an unknown language is a missing page. */
export function i18nFor(lang: string): ServerI18n {
  if (!isLang(lang)) notFound();
  return makeI18n(lang, messagesFor(lang));
}

/** The same, from a page's `params`. */
export async function pageI18n(params: Promise<{ lang: string }>): Promise<ServerI18n> {
  return i18nFor((await params).lang);
}
