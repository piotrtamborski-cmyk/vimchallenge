'use client';

/**
 * The daily challenge for a signed-in player: today's set before they start, its tasks one at a
 * time (each played in TimedTask), the pause between them, and the result at the end. The server
 * keeps the run; the page asks for it again after each action and when a clock runs out.
 */
import type { DailyView, RunTaskView, RunView, SetView } from '@vimchallenge/daily';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalTime } from './LocalTime';
import { clock, seconds, TimedTask, type Send } from './TimedTask';

const STATUS: Record<RunTaskView['status'], string> = {
  open: 'playing',
  solved: 'solved',
  skipped: 'skipped',
  timeout: 'out of time',
  'not-reached': 'not reached',
};

const START_ERROR: Record<string, string> = {
  'not-eligible': 'The daily challenge needs an account with a verified email address.',
  played: 'You have already played today’s set. A new one comes at midnight UTC.',
  busy: 'Finish the set you started first.',
  'no-tasks': 'There is no set today.',
};

const minutes = (ms: number) => `${Math.round(ms / 60_000)} minutes`;

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
  return (
    <table className="w-full max-w-xl border-collapse text-left">
      <thead>
        <tr className="text-sm text-muted">
          <th className="py-1 pr-4 font-normal">Task</th>
          <th className="py-1 pr-4 font-normal">Level</th>
          <th className="py-1 pr-4 font-normal">Points</th>
          <th className="py-1 font-normal">Time</th>
        </tr>
      </thead>
      <tbody>
        {set.tasks.map((t) => (
          <tr key={t.position} className={`border-t border-line ${t.voided ? 'text-muted line-through' : ''}`}>
            <td className="py-1.5 pr-4 font-mono">{t.position}</td>
            <td className="py-1.5 pr-4">{t.level}</td>
            <td className="py-1.5 pr-4 font-mono">
              {t.base} to {t.maxPoints}
            </td>
            <td className="py-1.5 font-mono">{clock(t.availableMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Start({ view, engineReady, apply }: { view: DailyView; engineReady: boolean; apply: (v: DailyView) => void }) {
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
    if (res.ok !== true) setError(START_ERROR[String(res.error)] ?? 'That did not work. Please try again.');
  };
  return (
    <div className="space-y-8">
      {you.yesterday && (
        <p>
          Yesterday you scored {you.yesterday.points} of {you.yesterday.maxPoints} points: {you.yesterday.league} league points.{' '}
          <Link href={`/leaderboards?period=day&at=${you.yesterday.day}`} className="underline">
            Yesterday’s table →
          </Link>
        </p>
      )}
      <section aria-labelledby="today" className="space-y-4">
        <h2 id="today" className="text-lg font-semibold">
          Today’s set
        </h2>
        <SetTable set={view.set} />
        <ul className="list-inside list-disc space-y-1 text-muted">
          <li>One go per account and day. Each task appears when you start it, and its clock starts then.</li>
          <li>A solve earns the points of its level, and up to a quarter more for speed. Skipping or running out of time earns nothing.</li>
          <li>
            The whole set must be done within {minutes(view.set.totalMs)} of starting. You can start until midnight UTC (
            <LocalTime ms={view.nextDayAt} />
            ).
          </li>
        </ul>
      </section>
      <div className="space-y-3">
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={boards} onChange={(e) => setBoards(e.target.checked)} className="mt-1" />
          <span>
            Show my name on the public leaderboards
            <span className="block text-sm text-muted">Otherwise you still see your own place. You can change this on your account page.</span>
          </span>
        </label>
        <button
          type="button"
          disabled={busy || !engineReady}
          onClick={() => void start()}
          className="rounded bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-50"
        >
          {engineReady ? 'Start today’s set' : 'Loading the editor…'}
        </button>
        <p role="status" className="min-h-6 text-bad">
          {error}
        </p>
      </div>
    </div>
  );
}

function Progress({ run }: { run: RunView }) {
  return (
    <ol className="flex flex-wrap gap-2 text-sm" aria-label="Tasks of the set">
      {run.tasks.map((t) => (
        <li
          key={t.position}
          className={`rounded border px-2 py-1 ${t.status === 'open' ? 'border-accent' : 'border-line'} ${t.voided ? 'line-through' : ''}`}
        >
          {t.position}. level {t.level} ·{' '}
          <span className={t.status === 'solved' ? 'text-good' : 'text-muted'}>
            {t.status === 'solved' ? `${t.earned} points` : STATUS[t.status]}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Playing({ run, now, apply, refresh }: { run: RunView; now: number; apply: (v: DailyView) => void; refresh: () => Promise<void> }) {
  const c = run.current;
  const send = useCallback<Send>((action, body) => post(action, { day: run.day, position: c?.position, ...body }), [run.day, c?.position]);
  const [busy, setBusy] = useState(false);
  const next = async () => {
    setBusy(true);
    const res = await post('next', { day: run.day });
    setBusy(false);
    if (res.view) apply(res.view as DailyView);
  };
  const last = [...run.tasks].reverse().find((t) => t.status !== 'not-reached' && t.status !== 'open');
  const upcoming = run.tasks.find((t) => t.position === run.next);

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
              Task {c.position} of {run.tasks.length} · level {c.level}: {c.base} points for a solve, up to {Math.floor(c.base / 4)} more for speed
              (full bonus within {Math.round(c.referenceMs / 1000)} s)
            </p>
          }
          onDone={() => void refresh()}
        />
      ) : (
        <section className="space-y-4" aria-live="polite">
          {last && (
            <p className="text-lg">
              Task {last.position}:{' '}
              {last.status === 'solved' ? (
                <span className="text-good">
                  solved in {seconds(last.ms!)}, {last.earned - last.bonus} + {last.bonus} = {last.earned} points.
                </span>
              ) : (
                STATUS[last.status]
              )}
            </p>
          )}
          {upcoming ? (
            <>
              <p>
                Next: task {upcoming.position}, level {upcoming.level}, up to {upcoming.maxPoints} points, {clock(Math.min(upcoming.availableMs, run.endsAt - now))}{' '}
                to solve it. Its clock starts when you do.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void next()}
                className="rounded bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-50"
              >
                Start task {upcoming.position}
              </button>
              <p className="text-sm text-muted">Time left for the whole set: {clock(run.endsAt - now)}</p>
            </>
          ) : (
            <p className="text-muted">Finishing your run…</p>
          )}
        </section>
      )}
    </div>
  );
}

function Result({ run }: { run: RunView }) {
  return (
    <section aria-labelledby="result" className="space-y-6">
      <div className="space-y-1">
        <h2 id="result" className="text-xl font-semibold">
          Your run of {run.day}: {run.points} of {run.maxPoints} points
        </h2>
        <p>
          {run.league} league points (the share of the most the set could give, out of 1000) ·{' '}
          <Link href={`/leaderboards?period=day&at=${run.day}`} className="underline">
            See the table →
          </Link>
        </p>
      </div>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-sm text-muted">
            <th className="py-1 pr-4 font-normal">Task</th>
            <th className="py-1 pr-4 font-normal">Result</th>
            <th className="py-1 pr-4 font-normal">Time</th>
            <th className="py-1 pr-4 font-normal">Points</th>
            <th className="py-1 font-normal" />
          </tr>
        </thead>
        <tbody>
          {run.tasks.map((t) => (
            <tr key={t.position} className="border-t border-line">
              <td className="py-1.5 pr-4">
                {t.position}. {t.title ?? `level ${t.level}`}
                {t.voided && <span className="text-sm text-muted"> (voided: it does not count)</span>}
              </td>
              <td className="py-1.5 pr-4">{STATUS[t.status]}</td>
              <td className="py-1.5 pr-4 font-mono">{t.ms !== undefined ? seconds(t.ms) : '–'}</td>
              <td className="py-1.5 pr-4 font-mono">{t.status === 'solved' ? `${t.earned - t.bonus} + ${t.bonus} = ${t.earned}` : '0'}</td>
              <td className="py-1.5 text-sm">
                {t.taskId && t.practise !== undefined && (
                  <Link href={`/tasks/${t.taskId}?text=${t.practise}`} className="underline">
                    Practise{t.practise === t.text ? '' : ' on another text'} →
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-muted">
        The table of the day is final once every run that could start before midnight UTC is over. A new set comes at midnight UTC.
      </p>
    </section>
  );
}
