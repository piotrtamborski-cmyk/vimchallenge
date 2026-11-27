import type { Metadata } from 'next';
import Link from 'next/link';
import { i18nFor } from '@/lib/i18n/server';

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: i18nFor((await params).lang).m.privacy.title };
}

export default async function PrivacyPage({ params }: Props) {
  const i = i18nFor((await params).lang);
  const p = i.m.privacy;
  const section = (title: string, ...body: React.ReactNode[]) => (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {body}
    </section>
  );
  return (
    <article className="max-w-3xl space-y-6 leading-relaxed">
      <h1 className="text-2xl font-semibold">{p.title}</h1>
      {section(p.guestTitle, <p key="p">{p.guest}</p>)}
      {section(
        p.accountTitle,
        <ul key="l" className="list-inside list-disc space-y-1">
          <li>{p.accountName}</li>
          <li>{p.accountSignIn}</li>
          <li>{p.accountSessions}</li>
          <li>{p.accountSolves}</li>
          <li>{p.accountLinks}</li>
        </ul>,
        <p key="p">{p.noSelling}</p>,
      )}
      {section(p.roomTitle, <p key="p">{p.room}</p>)}
      {section(p.dailyTitle, <p key="p">{p.daily}</p>, <p key="b">{p.dailyBoards}</p>)}
      {section(p.cookiesTitle, <p key="p">{p.cookies}</p>)}
      {section(p.servicesTitle, <p key="p">{p.services}</p>)}
      {section(
        p.deletingTitle,
        <p key="p">
          {i.rich(p.deleting, {
            link: (text) => (
              <Link href={i.href('/account')} className="underline">
                {text}
              </Link>
            ),
          })}
        </p>,
      )}
      <p className="text-sm text-muted">
        {i.rich(p.code, {
          link: (
            <a className="underline" href="https://github.com/piotrtamborski-cmyk/vimchallenge">
              github.com/piotrtamborski-cmyk/vimchallenge
            </a>
          ),
        })}
      </p>
    </article>
  );
}
