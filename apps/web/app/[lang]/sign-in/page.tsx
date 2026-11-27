import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Message } from '@/components/Messages';
import { errorMessage } from '@/lib/auth/messages';
import { safeReturn } from '@/lib/auth/routes';
import { currentUser, signInMethods } from '@/lib/auth/session';
import { i18nFor } from '@/lib/i18n/server';

type Props = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ next?: string; error?: string; methods?: string; sent?: string; deleted?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: i18nFor((await params).lang).m.signIn.title };
}

export default async function SignInPage({ params, searchParams }: Props) {
  const i = i18nFor((await params).lang);
  const { m, href } = i;
  const query = await searchParams;
  const next = safeReturn(query.next, href('/'));
  if (!query.error && (await currentUser())) redirect(next);
  const methods = signInMethods();
  const nextQuery = next === href('/') ? '' : `?next=${encodeURIComponent(next)}`;
  const none = !methods.github && !methods.google && !methods.email;

  return (
    <div className="max-w-md space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{m.signIn.title}</h1>
        <p className="text-muted">{m.signIn.intro}</p>
      </header>

      <Message error={errorMessage(i, query.error, query.methods)} notice={query.sent ? m.signIn.sent : query.deleted ? m.signIn.deleted : undefined} />

      {none && <p>{m.signIn.notSetUp}</p>}

      {(methods.github || methods.google) && (
        <div className="flex flex-col gap-3">
          {methods.github && (
            <a href={`/api/auth/github/start${nextQuery}`} className="rounded border border-line px-4 py-2 text-center font-semibold hover:bg-line/40">
              {m.signIn.github}
            </a>
          )}
          {methods.google && (
            <a href={`/api/auth/google/start${nextQuery}`} className="rounded border border-line px-4 py-2 text-center font-semibold hover:bg-line/40">
              {m.signIn.google}
            </a>
          )}
        </div>
      )}

      {methods.email && (
        <form method="post" action="/api/auth/email" className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <label className="block space-y-1">
            <span className="font-semibold">{methods.github || methods.google ? m.signIn.orEmail : m.signIn.byEmail}</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              maxLength={254}
              className="block w-full rounded border border-line bg-panel px-3 py-2"
              placeholder={m.signIn.placeholder}
            />
          </label>
          <button type="submit" className="rounded bg-accent px-4 py-2 font-semibold text-accent-ink">
            {m.signIn.emailMe}
          </button>
        </form>
      )}

      <p className="text-sm text-muted">
        {i.rich(m.signIn.newAccount, {
          link: (text) => (
            <Link href={href('/privacy')} className="underline">
              {text}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}
