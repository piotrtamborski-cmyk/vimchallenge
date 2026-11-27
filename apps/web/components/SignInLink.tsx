'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { localePath, splitLang } from '@/lib/i18n/locales';
import { usePageLang } from './I18n';

/**
 * "Sign in", coming back to the page it was clicked on (the layout stays while pages change).
 * `lang` is needed outside the language provider, in the layout's header.
 */
export function SignInLink({ className, children, lang }: { className?: string; children: React.ReactNode; lang?: string }) {
  const pageLang = usePageLang();
  const path = usePathname();
  const search = useSearchParams().toString();
  const here = path + (search ? `?${search}` : '');
  const signIn = localePath(lang ?? pageLang ?? 'en', '/sign-in');
  const bare = splitLang(path).path;
  const href = bare === '/' || bare.startsWith('/sign-in') ? signIn : `${signIn}?next=${encodeURIComponent(here)}`;
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
