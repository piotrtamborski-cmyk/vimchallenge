import { headers } from 'next/headers';
import Link from 'next/link';
import { DEFAULT_LANG, isLang } from '@/lib/i18n/locales';
import { i18nFor } from '@/lib/i18n/server';

export default async function NotFound() {
  // A not-found page gets no params: the language comes from the proxy.
  const lang = (await headers()).get('x-page-lang');
  const { m, href } = i18nFor(isLang(lang) ? lang : DEFAULT_LANG);
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">{m.notFound.title}</h1>
      <p>{m.notFound.body}</p>
      <p>
        <Link href={href('/')} className="underline">
          {m.notFound.home}
        </Link>
      </p>
    </div>
  );
}
