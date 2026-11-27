import type { Metadata } from 'next';
import Link from 'next/link';
import { DailyGame } from '@/components/Daily';
import { LocalTime } from '@/components/LocalTime';
import { SignInLink } from '@/components/SignInLink';
import { currentUser } from '@/lib/auth/session';
import { dailyContext } from '@/lib/daily/context';

export const metadata: Metadata = {
  title: 'Daily challenge',
  description: 'Five Vim tasks a day, one per level, the same for everyone: one go, against the clock, for the leaderboards.',
};

export default async function DailyPage() {
  const user = await currentUser();
  const view = dailyContext().view(user?.id);
  const you = view.you;

  return (
    <div className="space-y-8">
      <header className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold">Daily challenge</h1>
        <p className="text-muted">
          Five tasks, one per level, the same for everyone today. One go per account; your result counts for the daily, weekly, monthly and
          all-time{' '}
          <Link href="/leaderboards" className="underline">
            leaderboards
          </Link>
          .
        </p>
      </header>
      {!user ? (
        <div className="space-y-3">
          <p>
            <SignInLink className="underline">Sign in</SignInLink> to play today’s set. Until midnight UTC (<LocalTime ms={view.nextDayAt} />)
            everyone gets the same five tasks.
          </p>
          <p className="text-muted">
            Without an account you can{' '}
            <Link href="/tasks" className="underline">
              practise any task
            </Link>{' '}
            or play with friends in a{' '}
            <Link href="/rooms" className="underline">
              room
            </Link>
            .
          </p>
        </div>
      ) : !you!.eligible && !you!.run ? (
        <p>
          The daily challenge needs a verified email address on your account, so that each player has one go. Connect an email link,
          or a GitHub or Google account with a verified address, on{' '}
          <Link href="/account" className="underline">
            your account page
          </Link>
          .
        </p>
      ) : (
        <DailyGame initial={view} />
      )}
    </div>
  );
}
