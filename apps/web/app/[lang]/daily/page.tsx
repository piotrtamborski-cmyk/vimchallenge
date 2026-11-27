import type { Metadata } from 'next';
import Link from 'next/link';
import { DailyGame } from '@/components/Daily';
import { LocalTime } from '@/components/LocalTime';
import { SignInLink } from '@/components/SignInLink';
import { currentUser } from '@/lib/auth/session';
import { dailyContext } from '@/lib/daily/context';
import { i18nFor } from '@/lib/i18n/server';

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { m } = i18nFor((await params).lang);
  return { title: m.dailyPage.title, description: m.dailyPage.description };
}

export default async function DailyPage({ params }: Props) {
  const i = i18nFor((await params).lang);
  const { m, href } = i;
  const user = await currentUser();
  const view = dailyContext().view(user?.id);
  const you = view.you;
  const link = (to: string) => (text: React.ReactNode) => (
    <Link href={href(to)} className="underline">
      {text}
    </Link>
  );

  return (
    <div className="space-y-8">
      <header className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold">{m.dailyPage.title}</h1>
        <p className="text-muted">{i.rich(m.dailyPage.intro, { link: link('/leaderboards') })}</p>
      </header>
      {!user ? (
        <div className="space-y-3">
          <p>
            {i.rich(m.dailyPage.signedOut, {
              signin: (text) => <SignInLink className="underline">{text}</SignInLink>,
              time: <LocalTime ms={view.nextDayAt} />,
            })}
          </p>
          <p className="text-muted">{i.rich(m.dailyPage.guests, { tasks: link('/tasks'), rooms: link('/rooms') })}</p>
        </div>
      ) : !you!.eligible && !you!.run ? (
        <p>{i.rich(m.dailyPage.needsEmail, { link: link('/account') })}</p>
      ) : (
        <DailyGame initial={view} />
      )}
    </div>
  );
}
