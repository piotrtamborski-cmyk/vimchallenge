/**
 * The dictionaries. `en.ts` is the source: its shape is the type every other language must match,
 * so a missing message is a type error. A language is added by a file here and its code in
 * `LANGS` (locales.ts).
 */
import { PSEUDO_LANG } from '../locales.ts';
import { pseudo, type Plural } from '../format.ts';
import { en } from './en.ts';

/** The shape of `en` with every text widened to `string`, and every plural to any plural. */
type Widen<T> = T extends string ? string : T extends { other: string } ? Plural : { [K in keyof T]: Widen<T[K]> };
export type Messages = Widen<typeof en>;

/** The parts of the dictionary the browser needs (the editor, the timed games); the rest stays on the server. */
export const CLIENT_NAMESPACES = ['common', 'lang', 'task', 'goals', 'editor', 'serverCheck', 'timed', 'daily', 'room'] as const;
export type ClientNamespace = (typeof CLIENT_NAMESPACES)[number];
export type ClientMessages = Pick<Messages, ClientNamespace>;

const dictionaries: Record<string, Messages> = { en };

/** The translated dictionaries, by language (for the tests that compare them with English). */
export const DICTIONARIES: Readonly<Record<string, Messages>> = dictionaries;

function mapTexts<T>(value: T, f: (s: string) => string): T {
  if (typeof value === 'string') return f(value) as T;
  return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, mapTexts(v, f)])) as T;
}

let pseudoMessages: Messages | undefined;

export function messagesFor(lang: string): Messages {
  if (lang === PSEUDO_LANG) return (pseudoMessages ??= mapTexts(en as Messages, pseudo));
  return dictionaries[lang] ?? en;
}

export function clientMessages(messages: Messages): ClientMessages {
  return Object.fromEntries(CLIENT_NAMESPACES.map((ns) => [ns, messages[ns]])) as ClientMessages;
}
