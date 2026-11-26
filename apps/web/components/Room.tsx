'use client';

/**
 * A live room: the lobby, the countdown, a round with the editor, the results between rounds and
 * at the end. The server sends the room as this player sees it (Server-Sent Events, with polling
 * when the stream is down); the page only renders it and sends the player's actions. Keys go to
 * the server in small packets while the player types, so a reload or another device can resume.
 */
import { checkGoals, type GoalFailure, type Snapshot } from '@vimchallenge/engine';
import type { BrowserEditor } from '@vimchallenge/engine/browser';
import type { AttemptStatus, CheckResult, MatchView, RoomView, RoundResult, RoundView } from '@vimchallenge/rooms';
import { score } from '@vimchallenge/rooms/scoring';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { describe, modeLabel, notation } from './goals';
import { useNonce } from './Nonce';
import { CodeText, Prompt } from './Prompt';

const LEVEL_NAME: Record<string, string> = { mixed: 'rising levels', 1: 'level 1', 2: 'level 2', 3: 'level 3', 4: 'level 4', 5: 'level 5' };
const STATUS: Record<AttemptStatus, string> = { open: 'working', solved: 'finished', skipped: 'skipped', timeout: 'out of time' };
const START_REASON: Record<string, string> = {
  'too-few': 'The match needs at least two players who are ready.',
  'not-host': 'The host starts the match.',
  running: 'A match is under way.',
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

async function post(code: string, action: string, body: object = {}): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`/api/rooms/${code}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => ({ error: `http-${res.status}` }))) as Record<string, unknown>;
  } catch {
    return { error: 'offline' };
  }
}

/** `invite`: the room's address to share, built from the site's public address on the server. */
export function Room({ initial, invite }: { initial: RoomView; invite: string }) {
  const code = initial.code;
  const [view, setView] = useState(initial);
  const [gone, setGone] = useState(false);
  const offset = useRef(initial.now - Date.now());
  const [, setTick] = useState(0);
  const [engineReady, setEngineReady] = useState(false);

  const apply = useCallback((v: RoomView) => {
    offset.current = v.now - Date.now();
    setView(v);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${code}`, { cache: 'no-store' });
      if (res.status === 404) setGone(true);
      else if (res.ok) apply((await res.json()) as RoomView);
    } catch {
      // Offline: the stream or the next poll catches up.
    }
  }, [code, apply]);

  // Live updates, with polling while the stream is down.
  useEffect(() => {
    const events = new EventSource(`/api/rooms/${code}/events`);
    events.onmessage = (e) => apply(JSON.parse(e.data as string) as RoomView);
    events.addEventListener('gone', () => setGone(true));
    const poll = setInterval(() => {
      if (events.readyState !== EventSource.OPEN) void refresh();
    }, 4000);
    return () => {
      events.close();
      clearInterval(poll);
    };
  }, [code, apply, refresh]);

  // The clock on the page, and a look at the room when a countdown or a round should be over (in
  // case the stream is late).
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  const round = view.match?.round;
  const nextAt = round ? (view.phase === 'round' ? round.deadline : round.startsAt) : undefined;
  useEffect(() => {
    if (nextAt === undefined) return;
    const t = setTimeout(() => void refresh(), Math.max(0, nextAt - (Date.now() + offset.current)) + 600);
    return () => clearTimeout(t);
  }, [nextAt, refresh]);

  // The editor loads before the match, so the first round starts without a wait.
  useEffect(() => {
    void import('@vimchallenge/engine/browser').then(() => setEngineReady(true));
  }, []);

  const now = Date.now() + offset.current;

  if (gone)
    return (
      <p>
        This room no longer exists.{' '}
        <Link href="/rooms" className="underline">
          Back to rooms
        </Link>
      </p>
    );

  return (
    <div className="space-y-8">
      <RoomHeader view={view} invite={invite} />
      {view.phase === 'countdown' && round && <Countdown match={view.match!} round={round} now={now} />}
      {view.phase === 'round' && round && (view.you?.playing && round.mine ? (
        <RoundPlay key={`${view.match!.number}:${round.number}`} code={code} match={view.match!} round={round} now={now} />
      ) : (
        <Watching match={view.match!} round={round} now={now} />
      ))}
      {view.phase === 'break' && round && <Break match={view.match!} round={round} now={now} />}
      {view.phase === 'finished' && view.match && <Final match={view.match} />}
      {(view.phase === 'lobby' || view.phase === 'finished') && <Lobby view={view} engineReady={engineReady} />}
      {view.phase !== 'lobby' && view.phase !== 'finished' && !view.you?.playing && (
        <p className="text-muted">A match is under way. You play in the next one; until then you can watch here.</p>
      )}
    </div>
  );
}

function RoomHeader({ view, invite: url }: { view: RoomView; invite: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">
        Room <span className="font-mono">{view.code}</span>
      </h1>
      <p className="text-muted">
        {view.settings.rounds} {view.settings.rounds === 1 ? 'round' : 'rounds'}, {LEVEL_NAME[view.settings.level]} ·{' '}
        {view.members.length} of 8 players
      </p>
      {(view.phase === 'lobby' || view.phase === 'finished') && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Invite others with this link:</span>
          <code className="rounded bg-line/50 px-1.5 py-0.5 font-mono">{url}</code>
          <button
            type="button"
            className="rounded border border-line px-2 py-1 hover:bg-line/40"
            onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </p>
      )}
    </header>
  );
}

function Lobby({ view, engineReady }: { view: RoomView; engineReady: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = view.you;
  const act = async (action: string, body: object = {}) => {
    setBusy(true);
    setError(null);
    const res = await post(view.code, action, body);
    setBusy(false);
    if (res.result && res.result !== 'ok') setError(START_REASON[String(res.result)] ?? `Could not start: ${String(res.result)}.`);
    else if (res.error) setError('That did not work. Please try again.');
    return res;
  };
  return (
    <section aria-labelledby="lobby" className="space-y-4">
      <h2 id="lobby" className="text-lg font-semibold">
        {view.phase === 'finished' ? 'Next match' : 'Players'}
      </h2>
      <ul className="space-y-1">
        {view.members.map((m) => (
          <li key={m.name} className="flex flex-wrap items-center gap-2">
            <span className={m.you ? 'font-semibold' : ''}>{m.name}</span>
            {m.host && <span className="rounded bg-line/50 px-1.5 text-xs">host</span>}
            {m.ready ? <span className="text-sm text-good">ready</span> : <span className="text-sm text-muted">not ready</span>}
            {m.away && <span className="text-sm text-muted">(away)</span>}
          </li>
        ))}
      </ul>
      {me && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || !engineReady}
            onClick={() => void act('ready', { ready: !me.ready })}
            className="rounded border border-line px-4 py-2 hover:bg-line/40 disabled:opacity-50"
          >
            {!engineReady ? 'Loading the editor…' : me.ready ? 'Not ready' : "I'm ready"}
          </button>
          {(me.host || view.start.allowed) && (
            <button
              type="button"
              disabled={busy || !view.start.allowed}
              onClick={() => void act('start')}
              className="rounded bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-50"
            >
              Start the match
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void act('leave').then(() => router.push('/rooms'))}
            className="rounded px-2 py-2 text-sm text-muted underline"
          >
            Leave the room
          </button>
        </div>
      )}
      {!view.start.allowed && view.start.reason && START_REASON[view.start.reason] && (
        <p className="text-sm text-muted">{START_REASON[view.start.reason]}</p>
      )}
      <p role="status" className="min-h-6 text-bad">
        {error}
      </p>
    </section>
  );
}

function RoundTitle({ match, round }: { match: MatchView; round: RoundView }) {
  return (
    <p className="text-sm text-muted">
      Round {round.number} of {match.rounds} · level {round.level}: {round.base} points for a solve, up to{' '}
      {round.base / 4} more for speed (full bonus within {Math.round(round.referenceMs / 1000)} s)
    </p>
  );
}

function Countdown({ match, round, now }: { match: MatchView; round: RoundView; now: number }) {
  return (
    <section className="space-y-3" aria-live="polite">
      <RoundTitle match={match} round={round} />
      <p className="text-3xl font-semibold">Round {round.number} starts in {Math.max(0, Math.ceil((round.startsAt - now) / 1000))}…</p>
      <p className="text-muted">The task appears for everyone at the same moment. Keep your hands near the keyboard.</p>
    </section>
  );
}

function Statuses({ round }: { round: RoundView }) {
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {round.statuses.map((s) => (
        <li key={s.name}>
          <span className={s.you ? 'font-semibold' : ''}>{s.name}</span>{' '}
          <span className={s.status === 'solved' ? 'text-good' : 'text-muted'}>{STATUS[s.status]}</span>
          {s.away && <span className="text-muted"> (away)</span>}
        </li>
      ))}
    </ul>
  );
}

function Watching({ match, round, now }: { match: MatchView; round: RoundView; now: number }) {
  return (
    <section className="space-y-3">
      <RoundTitle match={match} round={round} />
      <p className="font-mono text-2xl">{clock(round.deadline - now)}</p>
      <Statuses round={round} />
    </section>
  );
}

function RoundPlay({ code, match, round, now }: { code: string; match: MatchView; round: RoundView; now: number }) {
  const task = round.task!;
  const mine = round.mine!;
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
    sending.current = post(code, 'keys', { round: round.number, from, keys: batch })
      .then((res) => {
        if (typeof res.have === 'number') sent.current = res.have;
        if (res.error === 'closed') setMessage('This round is over for you.');
        if (res.error === 'too-many-keys') setMessage('This round has more keys than the server accepts.');
      })
      .finally(() => {
        sending.current = null;
      });
    return sending.current;
  }, [code, round.number]);

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
    const res = (await post(code, 'check', { round: round.number, count: ed.log().length })) as CheckResult | { error: string };
    if ('result' in res && res.result === 'solved') {
      setSolve(res);
      setMessage(null);
      ed.destroy();
      editor.current = null;
    } else if ('result' in res && res.result === 'failed') {
      setFailures(res.failures);
      setMessage(null);
    } else if ('result' in res && res.result === 'error' && res.error === 'missing-keys') {
      sent.current = res.have ?? 0;
      setMessage('Some keys had not reached the server yet. Press Check again.');
    } else if ('result' in res && res.result === 'error' && res.error === 'judge-unavailable') {
      setMessage('The server could not check right now. Press Check again: the time of this check is kept.');
    } else if ('result' in res && (res.result === 'closed' || (res.result === 'error' && res.error === 'late'))) {
      setMessage('Too late: the round is over.');
    } else if ('result' in res && res.result === 'rejected') {
      setMessage(`The server refused this run (${res.reason}).`);
    } else {
      setMessage('The check did not reach the server. Please try again.');
    }
  }, [code, flush, round.number, solve, task.expected]);
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
    // One editor per round (the component is keyed by it): later updates of the room do not remount it.
  }, []);

  const elapsed = now - round.startsAt;
  const bonusNow = score(round.base, round.referenceMs, elapsed).bonus;

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" aria-labelledby="round-task">
      <div className="space-y-4">
        <RoundTitle match={match} round={round} />
        <h2 id="round-task" className="text-2xl font-semibold">
          {task.title}
        </h2>
        <Prompt text={task.prompt} className="text-lg leading-relaxed" />
        <p className="font-mono text-2xl" aria-label="Time left">
          {clock(round.deadline - now)}
        </p>
        {!closed && <p className="text-sm text-muted">A solve now earns {round.base} + {bonusNow} points.</p>}
        <Statuses round={round} />
      </div>
      <div className="space-y-3">
        {solve ? (
          <div role="status" className="space-y-1 rounded border border-good/40 p-4">
            <p className="font-semibold text-good">
              Solved in {seconds(solve.ms)}: {solve.base} + {solve.bonus} = {solve.base + solve.bonus} points.
            </p>
            <p className="text-muted">Waiting for the others to finish.</p>
          </div>
        ) : mine.status !== 'open' ? (
          <p role="status" className="text-muted">
            {mine.status === 'skipped' ? 'You skipped this round.' : 'Time is up for this round.'} Waiting for the others.
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
                  <span className="text-sm">No points for this round?</span>
                  <button
                    type="button"
                    onClick={() => void post(code, 'skip', { round: round.number })}
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

function RoundResults({ result }: { result: RoundResult }) {
  return (
    <table className="w-full border-collapse text-left">
      <caption className="pb-2 text-left font-semibold">
        Round {result.number}: {result.title} <span className="font-normal text-muted">(level {result.level})</span>
      </caption>
      <thead>
        <tr className="text-sm text-muted">
          <th className="py-1 pr-4 font-normal">Player</th>
          <th className="py-1 pr-4 font-normal">Result</th>
          <th className="py-1 pr-4 font-normal">Time</th>
          <th className="py-1 font-normal">Points</th>
        </tr>
      </thead>
      <tbody>
        {result.results.map((r) => (
          <tr key={r.name} className="border-t border-line">
            <td className={`py-1.5 pr-4 ${r.you ? 'font-semibold' : ''}`}>{r.name}</td>
            <td className="py-1.5 pr-4">{STATUS[r.status]}</td>
            <td className="py-1.5 pr-4 font-mono">{r.ms !== undefined ? seconds(r.ms) : '–'}</td>
            <td className="py-1.5 font-mono">{r.status === 'solved' ? `${r.base} + ${r.bonus} = ${r.base + r.bonus}` : '0'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Standings({ match, final }: { match: MatchView; final?: boolean }) {
  return (
    <table className="w-full border-collapse text-left">
      <caption className="pb-2 text-left font-semibold">{final ? 'Final table' : 'Standings'}</caption>
      <thead>
        <tr className="text-sm text-muted">
          <th className="py-1 pr-4 font-normal">Place</th>
          <th className="py-1 pr-4 font-normal">Player</th>
          <th className="py-1 pr-4 font-normal">Points</th>
          <th className="py-1 pr-4 font-normal">Solves</th>
          <th className="py-1 font-normal">Time on solves</th>
        </tr>
      </thead>
      <tbody>
        {match.standings.map((s) => (
          <tr key={s.name} className="border-t border-line">
            <td className="py-1.5 pr-4 font-mono">{s.rank}</td>
            <td className={`py-1.5 pr-4 ${s.you ? 'font-semibold' : ''}`}>{s.name}</td>
            <td className="py-1.5 pr-4 font-mono">{s.points}</td>
            <td className="py-1.5 pr-4 font-mono">{s.solves}</td>
            <td className="py-1.5 font-mono">{s.seconds} s</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Break({ match, round, now }: { match: MatchView; round: RoundView; now: number }) {
  const last = match.past.at(-1);
  return (
    <section className="space-y-6" aria-live="polite">
      <p className="text-2xl font-semibold">Round {round.number} starts in {Math.max(0, Math.ceil((round.startsAt - now) / 1000))}…</p>
      <RoundTitle match={match} round={round} />
      {last && <RoundResults result={last} />}
      <Standings match={match} />
    </section>
  );
}

function Final({ match }: { match: MatchView }) {
  return (
    <section className="space-y-6">
      <h2 className="text-xl font-semibold">Match {match.number} is over</h2>
      <Standings match={match} final />
      {match.past.map((r) => (
        <div key={r.number} className="space-y-2">
          <RoundResults result={r} />
          <p className="text-sm">
            <Link href={`/tasks/${r.taskId}?text=${r.text}`} className="underline">
              Practise “{r.title}” →
            </Link>
          </p>
        </div>
      ))}
      <p className="text-sm text-muted">
        Ties: more points first, then more solves, then less time on the solves (in whole seconds); players equal on all three
        share the place.
      </p>
    </section>
  );
}
