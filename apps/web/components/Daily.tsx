'use client';

/**
 * The daily challenge for a signed-in player: today's set before they start, its tasks one at a
 * time (each played in TimedTask), the pause between them, and the result at the end. The server
 * keeps the run; the page asks for it again after each action and when a clock runs out.
 */
import type { DailyView, RunTaskView, RunView, SetView } from '@vimchallenge/daily';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessages } from '@/lib/i18n/messages';
import { useI18n } from './I18n';
import { LocalTime } from './LocalTime';
import { clock, TimedTask, type Send } from './TimedTask';

/** Message names of a task's status in a run. */
const STATUS = { open: 'open', solved: 'solved', skipped: 'skipped', timeout: 'timeout', 'not-reached': 'notReached' } as const satisfies Record<
  RunTaskView['status'],
  string
>;

/** Message names of the server's reasons for not starting a run. */
const START_ERROR: Record<string, keyof ClientMessages['daily']['startError']> = {
  'not-eligible': 'notEligible',
  played: 'played',
  busy: 'busy',
  'no-tasks': 'noTasks',
};

async function post(action: string, body: object = {}): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`/api/daily/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => ({ error: `http-${res.status}` }))) as Record<string, unknown>;
  } catch {
    return { error: 'offline' };
  }
}

export function DailyGame({ initial }: { initial: DailyView }) {
  const [view, setView] = useState(initial);
  const offset = useRef(initial.now - Date.now());
  const [, setTick] = useState(0);
  const [engineReady, setEngineReady] = useState(false);

  const apply = useCallback((v: DailyView) => {
    offset.current = v.now - Date.now();
    setView(v);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/daily', { cache: 'no-store' });
      if (res.ok) apply((await res.json()) as DailyView);
    } catch {
      // Offline: the next look catches up.
    }
  }, [apply]);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  // The editor loads before the first task, so its clock does not run while it does.
  useEffect(() => {
    void import('@vimchallenge/engine/browser').then(() => setEngineReady(true));
  }, []);

  const run = view.you?.run;
  // Look again when the task's time or the run's time is up.
  const nextAt = run && !run.finished ? (run.current?.deadline ?? run.endsAt) : undefined;
  useEffect(() => {
    if (nextAt === undefined) return;
    const t = setTimeout(() => void refresh(), Math.max(0, nextAt - (Date.now() + offset.current)) + 600);
    return () => clearTimeout(t);
  }, [nextAt, refresh]);

  const now = Date.now() + offset.current;
  if (!run) return <Start view={view} engineReady={engineReady} apply={apply} />;
  if (run.finished) return <Result run={run} />;
  return <Playing run={run} now={now} apply={apply} refresh={refresh} />;
}

function SetTable({ set }: { set: SetView }) {
  const { m, t } = useI18n();
  return (
    <table className="w-full max-w-xl border-collapse text-left">
      <thead>
        <tr className="text-sm text-muted">
          <th className="py-1 pr-4 font-normal">{m.daily.task}</th>
          <th className="py-1 pr-4 font-normal">{m.daily.level}</th>
          <th className="py-1 pr-4 font-normal">{m.daily.points}</th>
          <th className="py-1 font-normal">{m.daily.time}</th>
        </tr>
      </thead>
      <tbody>
        {set.tasks.map((task) => (
          <tr key={task.position} className={`border-t border-line ${task.voided ? 'text-muted line-through' : ''}`}>
            <td className="py-1.5 pr-4 font-mono">{task.position}</td>
            <td className="py-1.5 pr-4">{task.level}</td>
            <td className="py-1.5 pr-4 font-mono">{t(m.daily.pointsRange, { from: task.base, to: task.maxPoints })}</td>
            <td className="py-1.5 font-mono">{clock(task.availableMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Start({ view, engineReady, apply }: { view: DailyView; engineReady: boolean; apply: (v: DailyView) => void }) {
  const i = useI18n();
  const { m, t } = i;
  const you = view.you!;
  const [boards, setBoards] = useState(you.onBoards ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    const res = await post('start', { boards });
    setBusy(false);
    if (res.view) apply(res.view as DailyView);
    if (res.ok !== true) {
      const reason = START_ERROR[String(res.error)];
      setError(reason ? m.daily.startError[reason] : m.common.didNotWork);
    }
  };
  return (
    <div className="space-y-8">
      {you.yesterday && (
        <p>
          {i.rich(m.daily.yesterday, {
            points: you.yesterday.points,
            max: you.yesterday.maxPoints,
            league: you.yesterday.league,
            link: (text) => (
              <Link href={i.href(`/leaderboards?period=day&at=${you.yesterday!.day}`)} className="underline">
                {text}
              </Link>
            ),
          })}
        </p>
      )}
      <section aria-labelledby="today" className="space-y-4">
        <h2 id="today" className="text-lg font-semibold">
          {m.daily.todaysSet}
        </h2>
        <SetTable set={view.set} />
        <ul className="list-inside list-disc space-y-1 text-muted">
          <li>{m.daily.ruleOneGo}</li>
          <li>{m.daily.rulePoints}</li>
          <li>
            {i.rich(m.daily.ruleTime, {
              minutes: t(m.daily.minutes, { n: Math.round(view.set.totalMs / 60_000) }),
              time: <LocalTime ms={view.nextDayAt} />,
            })}
          </li>
        </ul>
      </section>
      <div className="space-y-3">
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={boards} onChange={(e) => setBoards(e.target.checked)} className="mt-1" />
          <span>
            {m.daily.showName}
            <span className="block text-sm text-muted">{m.daily.showNameNote}</span>
          </span>
        </label>
        <button
          type="button"
          disabled={busy || !engineReady}
          onClick={() => void start()}
          className="rounded bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-50"
        >
          {engineReady ? m.daily.start : m.common.loadingEditor}
        </button>
        <p role="status" className="min-h-6 text-bad">
          {error}
        </p>
      </div>
    </div>
  );
}

function Progress({ run }: { run: RunView }) {
  const { m, t } = useI18n();
  return (
    <ol className="flex flex-wrap gap-2 text-sm" aria-label={m.daily.tasksOfSet}>
      {run.tasks.map((task) => (
        <li
          key={task.position}
          className={`rounded border px-2 py-1 ${task.status === 'open' ? 'border-accent' : 'border-line'} ${task.voided ? 'line-through' : ''}`}
        >
          {t(m.daily.progressItem, { position: task.position, level: task.level })} ·{' '}
          <span className={task.status === 'solved' ? 'text-good' : 'text-muted'}>
            {task.status === 'solved' ? t(m.common.points, { n: task.earned }) : m.daily.status[STATUS[task.status]]}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Playing({ run, now, apply, refresh }: { run: RunView; now: number; apply: (v: DailyView) => void; refresh: () => Promise<void> }) {
  const i = useI18n();
  const { m, t } = i;
  const c = run.current;
  const send = useCallback<Send>((action, body) => post(action, { day: run.day, position: c?.position, ...body }), [run.day, c?.position]);
  const [busy, setBusy] = useState(false);
  const next = async () => {
    setBusy(true);
    const res = await post('next', { day: run.day });
    setBusy(false);
    if (res.view) apply(res.view as DailyView);
  };
  const last = [...run.tasks].reverse().find((task) => task.status !== 'not-reached' && task.status !== 'open');
  const upcoming = run.tasks.find((task) => task.position === run.next);

  return (
    <div className="space-y-6">
      <Progress run={run} />
      {c ? (
        <TimedTask
          key={`${run.day}:${c.position}`}
          task={c.task}
          mine={c.mine}
          startsAt={c.startsAt}
          deadline={c.deadline}
          base={c.base}
          referenceMs={c.referenceMs}
          now={now}
          send={send}
          unit="task"
          heading={
            <p className="text-sm text-muted">
              {t(m.daily.heading, {
                position: c.position,
                count: run.tasks.length,
                level: c.level,
                base: c.base,
                bonus: Math.floor(c.base / 4),
                seconds: Math.round(c.referenceMs / 1000),
              })}
            </p>
          }
          onDone={() => void refresh()}
        />
      ) : (
        <section className="space-y-4" aria-live="polite">
          {last && (
            <p className="text-lg">
              {i.rich(m.daily.lastTask, {
                position: last.position,
                result:
                  last.status === 'solved' ? (
                    <span className="text-good">
                      {t(m.daily.lastSolved, { time: i.seconds(last.ms!), base: last.earned - last.bonus, bonus: last.bonus, total: last.earned })}
                    </span>
                  ) : (
                    m.daily.status[STATUS[last.status]]
                  ),
              })}
            </p>
          )}
          {upcoming ? (
            <>
              <p>
                {t(m.daily.next, {
                  position: upcoming.position,
                  level: upcoming.level,
                  points: upcoming.maxPoints,
                  clock: clock(Math.min(upcoming.availableMs, run.endsAt - now)),
                })}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void next()}
                className="rounded bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-50"
              >
                {t(m.daily.startTask, { position: upcoming.position })}
              </button>
              <p className="text-sm text-muted">{t(m.daily.timeLeft, { clock: clock(run.endsAt - now) })}</p>
            </>
          ) : (
            <p className="text-muted">{m.daily.finishing}</p>
          )}
        </section>
      )}
    </div>
  );
}

function Result({ run }: { run: RunView }) {
  const i = useI18n();
  const { m, t } = i;
  return (
    <section aria-labelledby="result" className="space-y-6">
      <div className="space-y-1">
        <h2 id="result" className="text-xl font-semibold">
          {t(m.daily.resultTitle, { day: i.day(run.day), points: run.points, max: run.maxPoints })}
        </h2>
        <p>
          {i.rich(m.daily.league, {
            league: run.league,
            link: (text) => (
              <Link href={i.href(`/leaderboards?period=day&at=${run.day}`)} className="underline">
                {text}
              </Link>
            ),
          })}
        </p>
      </div>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-sm text-muted">
            <th className="py-1 pr-4 font-normal">{m.daily.task}</th>
            <th className="py-1 pr-4 font-normal">{m.daily.result}</th>
            <th className="py-1 pr-4 font-normal">{m.daily.time}</th>
            <th className="py-1 pr-4 font-normal">{m.daily.points}</th>
            <th className="py-1 font-normal" />
          </tr>
        </thead>
        <tbody>
          {run.tasks.map((task) => (
            <tr key={task.position} className="border-t border-line">
              <td className="py-1.5 pr-4">
                {task.position}. {task.title ?? t(m.daily.levelN, { level: task.level })}
                {task.voided && <span className="text-sm text-muted"> {m.daily.voided}</span>}
              </td>
              <td className="py-1.5 pr-4">{m.daily.status[STATUS[task.status]]}</td>
              <td className="py-1.5 pr-4 font-mono">{task.ms !== undefined ? i.seconds(task.ms) : '–'}</td>
              <td className="py-1.5 pr-4 font-mono">{task.status === 'solved' ? `${task.earned - task.bonus} + ${task.bonus} = ${task.earned}` : '0'}</td>
              <td className="py-1.5 text-sm">
                {task.taskId && task.practise !== undefined && (
                  <Link href={i.href(`/tasks/${task.taskId}?text=${task.practise}`)} className="underline">
                    {task.practise === task.text ? m.daily.practise : m.daily.practiseOther}
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-muted">
        {m.daily.finalNote}
      </p>
    </section>
  );
}
