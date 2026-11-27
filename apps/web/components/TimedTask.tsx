'use client';

/**
 * A task against the clock, checked by the server: a round of a room, or a task of the daily
 * challenge. The keys go to the server in small packets while the player types (so a reload or
 * another device resumes with them), and Check sends the count of keys it covers; the server
 * replays them with the judge and scores the solve by the time it received the check.
 */
import { checkGoals, type GoalFailure, type Snapshot } from '@vimchallenge/engine';
import type { BrowserEditor } from '@vimchallenge/engine/browser';
import type { AttemptStatus, CheckResult, TaskView } from '@vimchallenge/rooms';
import { score } from '@vimchallenge/rooms/scoring';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { describe, modeLabel, notation } from './goals';
import { useNonce } from './Nonce';
import { CodeText, Prompt } from './Prompt';

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export type Send = (action: 'keys' | 'check' | 'skip', body: object) => Promise<Record<string, unknown>>;

export interface TimedTaskProps {
  task: TaskView;
  mine: { status: AttemptStatus; keys: string[]; ms?: number; base: number; bonus: number };
  startsAt: number;
  deadline: number;
  /** Points for a solve, and the reference time of the bonus. */
  base: number;
  referenceMs: number;
  /** Server time now. */
  now: number;
  /** Sends an action of this attempt to the server. */
  send: Send;
  /** 'round' or 'task', in what the page says. */
  unit: string;
  /** Above the title: where in the game this is. */
  heading: ReactNode;
  /** Under the clock: who else is playing. */
  aside?: ReactNode;
  /** After a solve or a skip, what happens next ("Waiting for the others."). */
  waiting?: string;
  /** The attempt is over (solved or skipped), for the page to look at the game again. */
  onDone?: () => void;
}

export function TimedTask({ task, mine, startsAt, deadline, base, referenceMs, now, send, unit, heading, aside, waiting, onDone }: TimedTaskProps) {
  const titleId = useId();
  const nonce = useNonce();
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<BrowserEditor | null>(null);
  const sent = useRef(mine.keys.length);
  const sending = useRef<Promise<void> | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [keys, setKeys] = useState<readonly string[]>(mine.keys);
  const [failures, setFailures] = useState<GoalFailure[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [solve, setSolve] = useState<Extract<CheckResult, { result: 'solved' }> | null>(
    mine.status === 'solved' ? { result: 'solved', ms: mine.ms!, base: mine.base, bonus: mine.bonus } : null,
  );
  const [skipping, setSkipping] = useState(false);
  const closed = mine.status !== 'open' || !!solve;

  /** Sends the keys the server does not have yet, at most 500 at a time. */
  const flush = useCallback((): Promise<void> => {
    if (sending.current) return sending.current;
    const ed = editor.current;
    if (!ed || ed.log().length <= sent.current) return Promise.resolve();
    const from = sent.current;
    const batch = ed.log().slice(from, from + 500);
    sending.current = send('keys', { from, keys: batch })
      .then((res) => {
        if (typeof res.have === 'number') sent.current = res.have;
        if (res.error === 'closed') setMessage(`This ${unit} is over for you.`);
        if (res.error === 'too-many-keys') setMessage(`This ${unit} has more keys than the server accepts.`);
      })
      .finally(() => {
        sending.current = null;
      });
    return sending.current;
  }, [send, unit]);

  useEffect(() => {
    if (closed) return;
    const t = setInterval(() => void flush(), 250);
    return () => clearInterval(t);
  }, [flush, closed]);

  const check = useCallback(async () => {
    const ed = editor.current;
    if (!ed || solve) return;
    const local = checkGoals(ed.trail(), task.expected);
    if (local.length) {
      setFailures(local);
      return;
    }
    setFailures(null);
    setMessage('Checking on the server…');
    for (let i = 0; i < 50 && sent.current < ed.log().length; i++) {
      await flush();
      if (sent.current < ed.log().length) await new Promise((r) => setTimeout(r, 100));
    }
    const res = (await send('check', { count: ed.log().length })) as CheckResult | { error: string };
    if ('result' in res && res.result === 'solved') {
      setSolve(res);
      setMessage(null);
      ed.destroy();
      editor.current = null;
      onDone?.();
    } else if ('result' in res && res.result === 'failed') {
      setFailures(res.failures);
      setMessage(null);
    } else if ('result' in res && res.result === 'error' && res.error === 'missing-keys') {
      sent.current = res.have ?? 0;
      setMessage('Some keys had not reached the server yet. Press Check again.');
    } else if ('result' in res && res.result === 'error' && res.error === 'judge-unavailable') {
      setMessage('The server could not check right now. Press Check again: the time of this check is kept.');
    } else if ('result' in res && (res.result === 'closed' || (res.result === 'error' && res.error === 'late'))) {
      setMessage(`Too late: the ${unit} is over.`);
      onDone?.();
    } else if ('result' in res && res.result === 'rejected') {
      setMessage(`The server refused this run (${res.reason}).`);
    } else {
      setMessage('The check did not reach the server. Please try again.');
    }
  }, [flush, send, solve, task.expected, unit, onDone]);
  const checkRef = useRef(check);
  checkRef.current = check;

  useEffect(() => {
    if (closed) return;
    let cancelled = false;
    let ed: BrowserEditor | undefined;
    void import('@vimchallenge/engine/browser').then(({ mountEditor }) => {
      if (cancelled || !host.current) return;
      ed = mountEditor(host.current, {
        initial: task.initial,
        replay: mine.keys,
        allowPaste: false,
        cspNonce: nonce,
        onKey(step) {
          setSnapshot(step.snapshot);
          setKeys([...ed!.log()]);
          setFailures(null);
          setMessage(null);
        },
        onSubmit: () => void checkRef.current(),
        onRejected: setMessage,
      });
      editor.current = ed;
      setSnapshot(ed.snapshot());
    });
    return () => {
      cancelled = true;
      ed?.destroy();
      editor.current = null;
    };
    // One editor per attempt (the parent keys this component by it): later updates do not remount it.
  }, []);

  const bonusNow = score(base, referenceMs, now - startsAt).bonus;

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" aria-labelledby={titleId}>
      <div className="space-y-4">
        {heading}
        <h2 id={titleId} className="text-2xl font-semibold">
          {task.title}
        </h2>
        <Prompt text={task.prompt} className="text-lg leading-relaxed" />
        <p className="font-mono text-2xl" aria-label="Time left">
          {clock(deadline - now)}
        </p>
        {!closed && (
          <p className="text-sm text-muted">
            A solve now earns {base} + {bonusNow} points.
          </p>
        )}
        {aside}
      </div>
      <div className="space-y-3">
        {solve ? (
          <div role="status" className="space-y-1 rounded border border-good/40 p-4">
            <p className="font-semibold text-good">
              Solved in {seconds(solve.ms)}: {solve.base} + {solve.bonus} = {solve.base + solve.bonus} points.
            </p>
            {waiting && <p className="text-muted">{waiting}</p>}
          </div>
        ) : mine.status !== 'open' ? (
          <p role="status" className="text-muted">
            {mine.status === 'skipped' ? `You skipped this ${unit}.` : `Time is up for this ${unit}.`} {waiting}
          </p>
        ) : (
          <>
            <div ref={host} className="vc-editor min-h-28" />
            <div className="flex items-center justify-between font-mono text-sm text-muted">
              <span className="font-semibold text-ink">{snapshot ? `-- ${modeLabel(snapshot.mode)} --` : 'Loading editor…'}</span>
              {snapshot && <span>{snapshot.cursor.join(':')}</span>}
            </div>
            <p className="min-h-6 overflow-x-auto whitespace-nowrap font-mono text-sm" aria-label="Keys typed">
              <span className="text-muted">
                {keys.length} {keys.length === 1 ? 'key' : 'keys'}
              </span>{' '}
              {notation(keys.slice(-60))}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void check()}
                className="rounded bg-accent px-4 py-2 font-semibold text-accent-ink"
              >
                Check
              </button>
              {skipping ? (
                <>
                  <span className="text-sm">No points for this {unit}?</span>
                  <button
                    type="button"
                    onClick={() => void send('skip', {}).then(() => onDone?.())}
                    className="rounded border border-bad px-3 py-1.5 text-bad"
                  >
                    Yes, skip it
                  </button>
                  <button type="button" onClick={() => setSkipping(false)} className="text-sm underline">
                    Keep playing
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setSkipping(true)} className="rounded border border-line px-4 py-2 hover:bg-line/40">
                  Skip
                </button>
              )}
              <span className="text-sm text-muted">
                <kbd className="font-mono">Alt+Enter</kbd> checks without leaving the mode
              </span>
            </div>
          </>
        )}
        <div role="status" className="min-h-6 space-y-1">
          {message && <p>{message}</p>}
          {failures && (
            <>
              <p className="font-semibold text-bad">Not yet.</p>
              <ul className="list-inside list-disc">
                {failures.map((f) => (
                  <li key={f.field}>
                    <CodeText text={describe(f)} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
