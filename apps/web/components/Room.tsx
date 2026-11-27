'use client';

/**
 * A live room: the lobby, the countdown, a round with the editor, the results between rounds and
 * at the end. The server sends the room as this player sees it (Server-Sent Events, with polling
 * when the stream is down); the page only renders it and sends the player's actions. A round is
 * played in TimedTask, which sends the keys to the server while the player types.
 */
import type { AttemptStatus, MatchView, RoomView, RoundResult, RoundView } from '@vimchallenge/rooms';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clock, seconds, TimedTask, type Send } from './TimedTask';

const LEVEL_NAME: Record<string, string> = { mixed: 'rising levels', 1: 'level 1', 2: 'level 2', 3: 'level 3', 4: 'level 4', 5: 'level 5' };
const STATUS: Record<AttemptStatus, string> = { open: 'working', solved: 'solved', skipped: 'skipped', timeout: 'out of time' };
const START_REASON: Record<string, string> = {
  'too-few': 'The match needs at least two players who are ready.',
  'not-host': 'The host starts the match.',
  running: 'A match is under way.',
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
        <p className="text-muted">A match is under way. You’ll play in the next one; until then you can watch here.</p>
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
    if (res.result && res.result !== 'ok') setError(START_REASON[String(res.result)] ?? 'The match could not start. Please try again.');
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
              Start match
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void act('leave').then(() => router.push('/rooms'))}
            className="rounded px-2 py-2 text-sm text-muted underline"
          >
            Leave room
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
  const send = useCallback<Send>((action, body) => post(code, action, { round: round.number, ...body }), [code, round.number]);
  return (
    <TimedTask
      task={round.task!}
      mine={round.mine!}
      startsAt={round.startsAt}
      deadline={round.deadline}
      base={round.base}
      referenceMs={round.referenceMs}
      now={now}
      send={send}
      unit="round"
      heading={<RoundTitle match={match} round={round} />}
      aside={<Statuses round={round} />}
      waiting="Waiting for the others to finish."
    />
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
      <caption className="pb-2 text-left font-semibold">{final ? 'Final standings' : 'Standings'}</caption>
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
