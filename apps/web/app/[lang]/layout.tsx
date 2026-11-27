import type { Metadata } from 'next';
import { DM_Sans, IBM_Plex_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import Link from 'next/link';
import { Suspense } from 'react';
import { I18nProvider } from '@/components/I18n';
import { NonceProvider } from '@/components/Nonce';
import { SignInLink } from '@/components/SignInLink';
import { authConfig } from '@/lib/auth/context';
import { currentUser } from '@/lib/auth/session';
import { availableLangs, DEFAULT_LANG, isLang, LANG_NAMES, LANGS, localePath, splitLang } from '@/lib/i18n/locales';
import { clientMessages } from '@/lib/i18n/messages';
import { i18nFor } from '@/lib/i18n/server';
import '../globals.css';

const sans = DM_Sans({ subsets: ['latin', 'latin-ext'], variable: '--font-dm-sans' });
const mono = IBM_Plex_Mono({ subsets: ['latin', 'latin-ext'], weight: ['400', '600'], variable: '--font-plex-mono' });

type Props = { children: React.ReactNode; params: Promise<{ lang: string }> };

/** The page's address without the language code and with its query, as the proxy passed it on. */
async function pagePath(): Promise<string> {
  const path = (await headers()).get('x-page-path') ?? '/';
  return splitLang(path).path;
}

/** The layout's language: an unknown one shows the language's "page not found" in English. */
const layoutLang = async (params: Promise<{ lang: string }>) => {
  const { lang } = await params;
  return isLang(lang) ? lang : DEFAULT_LANG;
};

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { m } = i18nFor(await layoutLang(params));
  const path = (await pagePath()).split('?')[0]!;
  return {
    metadataBase: authConfig().publicUrl,
    title: { default: 'vimchallenge', template: '%s · vimchallenge' },
    description: m.meta.description,
    // The same page in every public language; search engines show each reader theirs.
    alternates: {
      languages: Object.fromEntries([...LANGS.map((l) => [l, localePath(l, path)]), ['x-default', localePath(DEFAULT_LANG, path)]]),
    },
  };
}

export default async function RootLayout({ children, params }: Props) {
  const i = i18nFor(await layoutLang(params));
  const { m, href } = i;
  // Set by proxy.ts for every page; reading it renders each page per request, with its own nonce.
  const head = await headers();
  const nonce = head.get('x-nonce') ?? undefined;
  const autoLang = head.get('x-lang-auto') === '1';
  const path = await pagePath();
  const user = await currentUser();
  const nav: [string, string][] = [
    ['/lessons', m.nav.lessons],
    ['/tasks', m.nav.tasks],
    ['/daily', m.nav.daily],
    ['/rooms', m.nav.rooms],
    ['/leaderboards', m.nav.leaderboards],
  ];
  return (
    <html lang={i.lang === 'xx' ? 'en' : i.lang} className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4">
          {m.nav.skip}
        </a>
        {autoLang && (
          <p className="border-b border-line bg-panel px-4 py-2 text-center text-sm">
            {i.rich(m.lang.autoNotice, {
              language: LANG_NAMES[i.lang] ?? i.lang,
              // A plain link: switching language is a full page load, which remembers the choice.
              link: (text) => (
                <a href={`/en${path}`} hrefLang="en" lang="en" className="underline">
                  {text}
                </a>
              ),
            })}
          </p>
        )}
        <header className="border-b border-line">
          <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href={href('/')} className="font-mono text-lg font-semibold">
              vimchallenge
            </Link>
            {nav.map(([to, label]) => (
              <Link key={to} href={href(to)} className="text-muted hover:text-ink">
                {label}
              </Link>
            ))}
            <span className="ml-auto">
              {user ? (
                <Link href={href('/account')} className="font-mono text-muted hover:text-ink">
                  {user.name}
                </Link>
              ) : (
                // The link reads the address's query, which a page without one (a 404) only has in the browser.
                <Suspense
                  fallback={
                    <Link href={href('/sign-in')} className="text-muted hover:text-ink">
                      {m.common.signIn}
                    </Link>
                  }
                >
                  <SignInLink className="text-muted hover:text-ink" lang={i.lang}>
                    {m.common.signIn}
                  </SignInLink>
                </Suspense>
              )}
            </span>
          </nav>
        </header>
        <main id="main" className="mx-auto max-w-5xl px-4 py-8">
          <NonceProvider nonce={nonce}>
            <I18nProvider lang={i.lang} messages={clientMessages(m)}>
              {children}
            </I18nProvider>
          </NonceProvider>
        </main>
        <footer className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-8 text-sm text-muted">
          <span>
            {m.footer.license} ·{' '}
            <a className="underline" href="https://github.com/piotrtamborski-cmyk/vimchallenge">
              GitHub
            </a>{' '}
            ·{' '}
            <Link className="underline" href={href('/privacy')}>
              {m.footer.privacy}
            </Link>
          </span>
          <LanguageMenu lang={i.lang} path={path} label={m.lang.menu} />
        </footer>
      </body>
    </html>
  );
}

/**
 * The same page in the other languages. Plain links: each is a full page load, and the proxy
 * remembers the language chosen (`/en/…` leads back to the address without a prefix).
 */
function LanguageMenu({ lang, path, label }: { lang: string; path: string; label: string }) {
  const langs = availableLangs();
  if (langs.length < 2) return null;
  return (
    <nav aria-label={label} className="ml-auto flex flex-wrap gap-x-3 gap-y-1">
      {langs.map((l) =>
        l === lang ? (
          <span key={l} aria-current="true" className="font-semibold text-ink">
            {LANG_NAMES[l]}
          </span>
        ) : (
          <a key={l} href={`/${l}${path === '/' ? '' : path}`} hrefLang={l} lang={l} className="hover:text-ink hover:underline">
            {LANG_NAMES[l]}
          </a>
        ),
      )}
    </nav>
  );
}
