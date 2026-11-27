/**
 * Messages with parts the page renders itself: `<link>Sign in</link> to play` and `{time}`
 * become elements, so a translation can move a link or a value anywhere in its sentence.
 */
import { Fragment, type ReactNode } from 'react';
import { formatNumber, isPlural, pluralForm, type Message } from './format.ts';

/** A value for a `{place}`, or a function that wraps the text of a `<tag>`. */
export type RichValues = Record<string, ReactNode | ((text: ReactNode) => ReactNode)>;

const TOKEN = /<(\w+)>([\s\S]*?)<\/\1>|\{(\w+)\}/g;

export function richText(lang: string, m: Message, values: RichValues = {}): ReactNode {
  const n = values.n;
  const text = isPlural(m) ? pluralForm(lang, m, typeof n === 'number' ? n : 0) : m;
  return parts(lang, text, values);
}

function parts(lang: string, text: string, values: RichValues): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const [all, tag, inner, place] = match;
    if (tag) {
      const wrap = values[tag];
      const content = parts(lang, inner ?? '', values);
      out.push(typeof wrap === 'function' ? wrap(content) : content);
    } else {
      const v = values[place!];
      out.push(v === undefined ? all : typeof v === 'number' ? formatNumber(lang, v) : typeof v === 'function' ? all : v);
    }
    last = match.index + all.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.map((p, i) => <Fragment key={i}>{p}</Fragment>);
}
