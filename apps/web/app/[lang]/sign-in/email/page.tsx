import type { Metadata } from 'next';
import Link from 'next/link';
import { authContext } from '@/lib/auth/context';
import { currentUser } from '@/lib/auth/session';
import { i18nFor } from '@/lib/i18n/server';

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<{ token?: string }> };

// The site's Referrer-Policy sends other sites the origin only, never this page's token.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: i18nFor((await params).lang).m.emailLink.title };
}

const b = (text: React.ReactNode) => <strong>{text}</strong>;

/**
 * Where the link in the email leads. Opening it changes nothing: mail scanners open links too.
 * The player confirms with a button, which uses the link up.
 */
export default async function EmailLinkPage({ params, searchParams }: Props) {
  const i = i18nFor((await params).lang);
  const { m, href } = i;
  const { token } = await searchParams;
  const link = token ? authContext().accounts.peekEmailLink(token) : undefined;
  if (!token || !link)
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">{m.emailLink.expiredTitle}</h1>
        <p>{m.emailLink.expiredBody}</p>
        <p>
          <Link href={href('/sign-in')} className="underline">
            {m.emailLink.askNew}
          </Link>
        </p>
      </div>
    );

  const user = link.linkTo ? await currentUser() : undefined;
  if (link.linkTo && user?.id !== link.linkTo)
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">{m.emailLink.elsewhereTitle}</h1>
        <p>{i.rich(m.emailLink.elsewhereBody, { b, email: link.email })}</p>
      </div>
    );

  return (
    <form method="post" action="/api/auth/email/verify" className="max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">{user ? m.emailLink.addTitle : m.signIn.title}</h1>
      <p>{user ? i.rich(m.emailLink.add, { b, email: link.email, name: user.name }) : i.rich(m.emailLink.signInAs, { b, email: link.email })}</p>
      <input type="hidden" name="token" value={token} />
      <button type="submit" className="rounded bg-accent px-4 py-2 font-semibold text-accent-ink">
        {user ? m.emailLink.addButton : m.emailLink.signInButton}
      </button>
    </form>
  );
}
