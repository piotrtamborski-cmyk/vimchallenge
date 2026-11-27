import { dayOf, PAGE_SIZE, PERIODS, periodDays, periodKey, shiftPeriod, validDay, type Board, type BoardRow, type Period } from '@vimchallenge/daily';
import type { Metadata } from 'next';
import Link from 'next/link';
import { currentUser } from '@/lib/auth/session';
import { dailyContext } from '@/lib/daily/context';
import { i18nFor, type ServerI18n } from '@/lib/i18n/server';

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<{ period?: string; at?: string; page?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { m } = i18nFor((await params).lang);
  return { title: m.leaderboards.title, description: m.leaderboards.description };
}

function title(i: ServerI18n, board: Board): string {
  const l = i.m.leaderboards;
  if (board.period === 'day') return i.day(board.first, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (board.period === 'week')
    return i.t(l.week, { from: i.day(board.first, { day: 'numeric', month: 'long' }), to: i.day(board.last, { day: 'numeric', month: 'long', year: 'numeric' }) });
  if (board.period === 'month') return i.day(board.first, { month: 'long', year: 'numeric' });
  return l.allTime;
}

/** The period asked for: any day of a week or month names it; without one, the period of today. */
function chosen(period: Period, at: string | undefined, today: string): string {
  if (period === 'all') return 'all';
  if (at && validDay(at)) return periodKey(period, at);
  if (at && period === 'month' && periodDays('month', at)) return at;
  return periodKey(period, today);
}

const boardPath = (period: Period, at: string, page = 0) => `/leaderboards?period=${period}${period === 'all' ? '' : `&at=${at}`}${page ? `&page=${page}` : ''}`;

export default async function LeaderboardsPage({ params: route, searchParams }: Props) {
  const i = i18nFor((await route).lang);
  const { m, t } = i;
  const l = m.leaderboards;
  const href = (period: Period, at: string, page = 0) => i.href(boardPath(period, at, page));
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
        <h1 className="text-2xl font-semibold">{l.title}</h1>
        <nav aria-label={l.period} className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={href(p, periodKey(p, board.first === '0000-01-01' ? today : board.first))}
              aria-current={p === period ? 'page' : undefined}
              className={`rounded border px-3 py-1 ${p === period ? 'border-accent font-semibold' : 'border-line hover:bg-line/40'}`}
            >
              {l.tabs[p]}
            </Link>
          ))}
        </nav>
      </header>

      <section aria-labelledby="board" className="space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 id="board" className="text-xl font-semibold">
            {title(i, board)}
          </h2>
          {before && (
            <Link href={href(period, before)} className="text-sm underline">
              {l.earlier}
            </Link>
          )}
          {after && after <= periodKey(period, today) && (
            <Link href={href(period, after)} className="text-sm underline">
              {l.later}
            </Link>
          )}
        </div>
        <p className="text-sm text-muted">
          {board.final ? l.final : period === 'all' ? l.allSoFar : l.notFinal} {daily ? l.dailyRule : l.leagueRule}
        </p>

        {board.rows.length === 0 ? (
          <p>
            {l.empty}{' '}
            {!board.you && (
              <Link href={i.href('/daily')} className="underline">
                {l.playToday}
              </Link>
            )}
          </p>
        ) : (
          <Table i={i} rows={board.rows} daily={daily} />
        )}

        {board.pages > 1 && (
          <nav aria-label={l.pages} className="flex gap-4 text-sm">
            {board.page > 0 && (
              <Link href={href(period, key, board.page - 1)} className="underline">
                {t(l.previous, { n: PAGE_SIZE })}
              </Link>
            )}
            <span className="text-muted">{t(l.page, { page: board.page + 1, pages: board.pages })}</span>
            {board.page + 1 < board.pages && (
              <Link href={href(period, key, board.page + 1)} className="underline">
                {t(l.next, { n: PAGE_SIZE })}
              </Link>
            )}
          </nav>
        )}

        {board.you && !youShown && (
          <p className="rounded border border-line p-3">
            {i.rich(l.yourPlace, {
              b: (text) => <strong>{text}</strong>,
              rank: board.you.rank,
              points: t(daily ? m.common.points : l.leaguePoints, { n: board.you.points }),
            })}
            {!board.you.listed && (
              <span className="text-muted">
                {' '}
                {i.rich(l.hidden, {
                  link: (text) => (
                    <Link href={i.href('/account#leaderboards')} className="underline">
                      {text}
                    </Link>
                  ),
                })}
              </span>
            )}
          </p>
        )}
      </section>

      {board.set && (
        <section aria-labelledby="set" className="space-y-2">
          <h2 id="set" className="text-lg font-semibold">
            {l.setTitle}
          </h2>
          <ol className="list-inside list-decimal space-y-1">
            {board.set.map((task) => (
              <li key={task.position} className={task.voided ? 'text-muted' : ''}>
                <Link href={i.href(`/tasks/${task.taskId}?text=${task.text}`)} className="underline">
                  {task.title}
                </Link>{' '}
                <span className="text-sm text-muted">
                  {t(l.levelN, { level: task.level })}
                  {task.voided && l.voided}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function Table({ i, rows, daily }: { i: ServerI18n; rows: BoardRow[]; daily: boolean }) {
  const l = i.m.leaderboards;
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="text-sm text-muted">
          <th className="py-1 pr-4 font-normal">{l.place}</th>
          <th className="py-1 pr-4 font-normal">{l.player}</th>
          {daily ? (
            <>
              <th className="py-1 pr-4 font-normal">{l.points}</th>
              <th className="py-1 pr-4 font-normal">{l.solves}</th>
              <th className="py-1 pr-4 font-normal">{l.timeOnSolves}</th>
              <th className="py-1 font-normal">{l.league}</th>
            </>
          ) : (
            <>
              <th className="py-1 pr-4 font-normal">{l.league}</th>
              <th className="py-1 font-normal">{l.daysPlayed}</th>
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
                <td className="py-1.5 pr-4 font-mono">{i.t(i.m.common.seconds, { n: r.seconds ?? 0 })}</td>
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
