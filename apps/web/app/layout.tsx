import type { Metadata } from 'next';
import { DM_Sans, IBM_Plex_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import Link from 'next/link';
import { NonceProvider } from '@/components/Nonce';
import { SignInLink } from '@/components/SignInLink';
import { currentUser } from '@/lib/auth/session';
import './globals.css';

const sans = DM_Sans({ subsets: ['latin', 'latin-ext'], variable: '--font-dm-sans' });
const mono = IBM_Plex_Mono({ subsets: ['latin', 'latin-ext'], weight: ['400', '600'], variable: '--font-plex-mono' });

export const metadata: Metadata = {
  title: { default: 'vimchallenge', template: '%s · vimchallenge' },
  description: 'Learn Vim techniques, practise them in a real editor and compete on the same tasks.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Set by proxy.ts for every page; reading it renders each page per request, with its own nonce.
  const head = await headers();
  const nonce = head.get('x-nonce') ?? undefined;
  const user = await currentUser();
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4">
          Skip to content
        </a>
        <header className="border-b border-line">
          <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-mono text-lg font-semibold">
              vimchallenge
            </Link>
            <Link href="/lessons" className="text-muted hover:text-ink">
              Lessons
            </Link>
            <Link href="/tasks" className="text-muted hover:text-ink">
              Tasks
            </Link>
            <span className="ml-auto">
              {user ? (
                <Link href="/account" className="font-mono text-muted hover:text-ink">
                  {user.name}
                </Link>
              ) : (
                <SignInLink className="text-muted hover:text-ink" />
              )}
            </span>
          </nav>
        </header>
        <main id="main" className="mx-auto max-w-5xl px-4 py-8">
          <NonceProvider nonce={nonce}>{children}</NonceProvider>
        </main>
        <footer className="mx-auto max-w-5xl px-4 py-8 text-sm text-muted">
          Open source under AGPL-3.0 ·{' '}
          <a className="underline" href="https://github.com/piotrtamborski-cmyk/vimchallenge">
            GitHub
          </a>{' '}
          ·{' '}
          <Link className="underline" href="/privacy">
            Privacy
          </Link>
        </footer>
      </body>
    </html>
  );
}
