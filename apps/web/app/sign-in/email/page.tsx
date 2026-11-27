import type { Metadata } from 'next';
import Link from 'next/link';
import { authContext } from '@/lib/auth/context';
import { currentUser } from '@/lib/auth/session';

// The site's Referrer-Policy sends other sites the origin only, never this page's token.
export const metadata: Metadata = { title: 'Sign in with your email link' };

type Props = { searchParams: Promise<{ token?: string }> };

/**
 * Where the link in the email leads. Opening it changes nothing: mail scanners open links too.
 * The player confirms with a button, which uses the link up.
 */
export default async function EmailLinkPage({ searchParams }: Props) {
  const { token } = await searchParams;
  const link = token ? authContext().accounts.peekEmailLink(token) : undefined;
  if (!token || !link)
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">This link no longer works</h1>
        <p>It has expired (links work for 15 minutes) or has already been used.</p>
        <p>
          <Link href="/sign-in" className="underline">
            Ask for a new link
          </Link>
        </p>
      </div>
    );

  const user = link.linkTo ? await currentUser() : undefined;
  if (link.linkTo && user?.id !== link.linkTo)
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">Open this link where you are signed in</h1>
        <p>
          This link adds <strong>{link.email}</strong> to an account. Open it in the browser where you are signed in to that account.
        </p>
      </div>
    );

  return (
    <form method="post" action="/api/auth/email/verify" className="max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">{user ? 'Add this address' : 'Sign in'}</h1>
      <p>
        {user ? (
          <>
            Add <strong>{link.email}</strong> to your account <strong>{user.name}</strong>, so you can also sign in with links sent there?
          </>
        ) : (
          <>
            Sign in as <strong>{link.email}</strong>? If you don't have an account yet, this creates one.
          </>
        )}
      </p>
      <input type="hidden" name="token" value={token} />
      <button type="submit" className="rounded bg-accent px-4 py-2 font-semibold text-accent-ink">
        {user ? 'Add address' : 'Sign in'}
      </button>
    </form>
  );
}
