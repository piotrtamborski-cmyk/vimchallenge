import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Message } from '@/components/Messages';
import { errorMessage } from '@/lib/auth/messages';
import { safeReturn } from '@/lib/auth/routes';
import { currentUser, signInMethods } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Sign in' };

type Props = { searchParams: Promise<{ next?: string; error?: string; methods?: string; sent?: string; deleted?: string }> };

export default async function SignInPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = safeReturn(params.next);
  if (!params.error && (await currentUser())) redirect(next);
  const methods = signInMethods();
  const query = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
  const none = !methods.github && !methods.google && !methods.email;

  return (
    <div className="max-w-md space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-muted">
          An account keeps your solved tasks and, later, your place in rooms and leaderboards. Training works without one.
        </p>
      </header>

      <Message
        error={errorMessage(params.error, params.methods)}
        notice={
          params.sent
            ? 'Check your inbox: the link signs you in once, within 15 minutes.'
            : params.deleted
              ? 'Your account and its progress are deleted.'
              : undefined
        }
      />

      {none && <p>Signing in is not set up on this server yet.</p>}

      {(methods.github || methods.google) && (
        <div className="flex flex-col gap-3">
          {methods.github && (
            <a href={`/api/auth/github/start${query}`} className="rounded border border-line px-4 py-2 text-center font-semibold hover:bg-line/40">
              Continue with GitHub
            </a>
          )}
          {methods.google && (
            <a href={`/api/auth/google/start${query}`} className="rounded border border-line px-4 py-2 text-center font-semibold hover:bg-line/40">
              Continue with Google
            </a>
          )}
        </div>
      )}

      {methods.email && (
        <form method="post" action="/api/auth/email" className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <label className="block space-y-1">
            <span className="font-semibold">{methods.github || methods.google ? 'Or get a link by email' : 'Get a sign-in link by email'}</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              maxLength={254}
              className="block w-full rounded border border-line bg-panel px-3 py-2"
              placeholder="you@example.com"
            />
          </label>
          <button type="submit" className="rounded bg-accent px-4 py-2 font-semibold text-accent-ink">
            Email me a link
          </button>
        </form>
      )}

      <p className="text-sm text-muted">
        A new account is made the first time you sign in. What is stored and why:{' '}
        <Link href="/privacy" className="underline">
          privacy
        </Link>
        .
      </p>
    </div>
  );
}
