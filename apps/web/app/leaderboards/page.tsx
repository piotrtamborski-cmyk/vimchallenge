import { dayOf, PAGE_SIZE, PERIODS, periodDays, periodKey, shiftPeriod, validDay, type Board, type BoardRow, type Period } from '@vimchallenge/daily';
import type { Metadata } from 'next';
import Link from 'next/link';
import { currentUser } from '@/lib/auth/session';
import { dailyContext } from '@/lib/daily/context';

export const metadata: Metadata = {
  title: 'Leaderboards',
  description: 'The daily challenge tables: today, this week, this month and all time.',
};

type Props = { searchParams: Promise<{ period?: string; at?: string; page?: string }> };

const TAB: Record<Period, string> = { day: 'Day', week: 'Week', month: 'Month', all: 'All time' };

const date = (day: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(Date.parse(`${day}T00:00:00Z`));

function title(board: Board): string {
  if (board.period === 'day') return date(board.first);
  if (board.period === 'week') return `Week of ${date(board.first, { day: 'numeric', month: 'long' })} to ${date(board.last, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  if (board.period === 'month') return date(board.first, { month: 'long', year: 'numeric' });
  return 'All time';
}

/** The period asked for: any day of a week or month names it; without one, the period of today. */
function chosen(period: Period, at: string | undefined, today: string): string {
  if (period === 'all') return 'all';
  if (at && validDay(at)) return periodKey(period, at);
  if (at && period === 'month' && periodDays('month', at)) return at;
  return periodKey(period, today);
}

const href = (period: Period, at: string, page = 0) => `/leaderboards?period=${period}${period === 'all' ? '' : `&at=${at}`}${page ? `&page=${page}` : ''}`;

export default async function LeaderboardsPage({ searchParams }: Props) {
  const params = await searchParams;
  const period: Period = PERIODS.includes(params.period as Period) ? (params.period as Period) : 'day';
  const today = dayOf(Date.now());
  const key = chosen(period, params.at, today);
  const user = await currentUser();
  const board = dailyContext().board(period, key, user?.id, Number(params.page ?? 0))!;
  const daily = period === 'day';
  const before = shiftPeriod(period, key, -1);
  const after = shiftPeriod(period, key, 1);
  const youShown = board.you && board.you.listed && board.rows.some((r) => r.you);

  return (
    <div className="max-w-4xl space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">Leaderboards</h1>
        <nav aria-label="Period" className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={href(p, periodKey(p, board.first === '0000-01-01' ? today : board.first))}
              aria-current={p === period ? 'page' : undefined}
              className={`rounded border px-3 py-1 ${p === period ? 'border-accent font-semibold' : 'border-line hover:bg-line/40'}`}
            >
              {TAB[p]}
            </Link>
          ))}
        </nav>
      </header>

      <section aria-labelledby="board" className="space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 id="board" className="text-xl font-semibold">
            {title(board)}
          </h2>
          {before && (
            <Link href={href(period, before)} className="text-sm underline">
              ← earlier
            </Link>
          )}
          {after && after <= periodKey(period, today) && (
            <Link href={href(period, after)} className="text-sm underline">
              later →
            </Link>
          )}
        </div>
        <p className="text-sm text-muted">
          {board.final
            ? 'Final.'
            : period === 'all'
              ? 'Every day so far, today included while its runs are under way.'
              : 'Not final yet: runs of this period may still be under way, so places can change.'}{' '}
          {daily
            ? 'Most points first, then more solves, then less time on them (in whole seconds); equal results share a place.'
            : 'League points summed over the days: each day gives up to 1000, the share of the most its set could give. Equal sums share a place.'}
        </p>

        {board.rows.length === 0 ? (
          <p>
            No one is on the public table yet.{' '}
            {!board.you && (
              <Link href="/daily" className="underline">
                Play today’s set →
              </Link>
            )}
          </p>
        ) : (
          <Table rows={board.rows} daily={daily} />
        )}

        {board.pages > 1 && (
          <nav aria-label="Pages" className="flex gap-4 text-sm">
            {board.page > 0 && (
              <Link href={href(period, key, board.page - 1)} className="underline">
                ← previous {PAGE_SIZE}
              </Link>
            )}
            <span className="text-muted">
              Page {board.page + 1} of {board.pages}
            </span>
            {board.page + 1 < board.pages && (
              <Link href={href(period, key, board.page + 1)} className="underline">
                next {PAGE_SIZE} →
              </Link>
            )}
          </nav>
        )}

        {board.you && !youShown && (
          <p className="rounded border border-line p-3">
            Your place: <strong>{board.you.rank}</strong> with {board.you.points} {daily ? 'points' : 'league points'}.
            {!board.you.listed && (
              <span className="text-muted">
                {' '}
                Your name is not on the public table;{' '}
                <Link href="/account#leaderboards" className="underline">
                  show it
                </Link>
                .
              </span>
            )}
          </p>
        )}
      </section>

      {board.set && (
        <section aria-labelledby="set" className="space-y-2">
          <h2 id="set" className="text-lg font-semibold">
            The set of this day
          </h2>
          <ol className="list-inside list-decimal space-y-1">
            {board.set.map((t) => (
              <li key={t.position} className={t.voided ? 'text-muted' : ''}>
                <Link href={`/tasks/${t.taskId}?text=${t.text}`} className="underline">
                  {t.title}
                </Link>{' '}
                <span className="text-sm text-muted">
                  level {t.level}
                  {t.voided && ', voided: it does not count'}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function Table({ rows, daily }: { rows: BoardRow[]; daily: boolean }) {
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="text-sm text-muted">
          <th className="py-1 pr-4 font-normal">Place</th>
          <th className="py-1 pr-4 font-normal">Player</th>
          {daily ? (
            <>
              <th className="py-1 pr-4 font-normal">Points</th>
              <th className="py-1 pr-4 font-normal">Solves</th>
              <th className="py-1 pr-4 font-normal">Time on solves</th>
              <th className="py-1 font-normal">League points</th>
            </>
          ) : (
            <>
              <th className="py-1 pr-4 font-normal">League points</th>
              <th className="py-1 font-normal">Days played</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className={`border-t border-line ${r.you ? 'font-semibold' : ''}`}>
            <td className="py-1.5 pr-4 font-mono">{r.rank}</td>
            <td className="py-1.5 pr-4">{r.name}</td>
            <td className="py-1.5 pr-4 font-mono">{r.points}</td>
            {daily ? (
              <>
                <td className="py-1.5 pr-4 font-mono">{r.solves}</td>
                <td className="py-1.5 pr-4 font-mono">{r.seconds} s</td>
                <td className="py-1.5 font-mono">{r.league}</td>
              </>
            ) : (
              <td className="py-1.5 font-mono">{r.days}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
