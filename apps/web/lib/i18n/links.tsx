/** A list of links joined the way the language joins words: `A, B and C`. */
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { I18n } from './i18n.ts';

export function linkList(i: I18n<unknown>, links: { href: string; title: string }[], type: 'conjunction' | 'disjunction' = 'conjunction'): ReactNode {
  // The list is formatted with places for the links, then each place becomes its link.
  const places = links.map((_, n) => `{l${n}}`);
  const values = Object.fromEntries(
    links.map((l, n) => [
      `l${n}`,
      <Link key={l.href} href={l.href} className="underline">
        {l.title}
      </Link>,
    ]),
  );
  return i.rich(i.list(places, type), values);
}
