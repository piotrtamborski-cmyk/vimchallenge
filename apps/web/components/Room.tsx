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
import { useI18n } from './I18n';
import { clock, TimedTask, type Send } from './TimedTask';

/** Message names of the reasons the match cannot start yet. */
const START_REASON: Record<string, 'tooFew' | 'notHost' | 'running'> = { 'too-few': 'tooFew', 'not-host': 'notHost', running: 'running' };

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
  const i = useI18n();
  const { m } = i;

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
        {i.rich(m.room.gone, {
          link: (text) => (
            <Link href={i.href('/rooms')} className="underline">
              {text}
            </Link>
          ),
        })}
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
        <p className="text-muted">{m.room.underWay}</p>
      )}
    </div>
  );
}

function RoomHeader({ view, invite: url }: { view: RoomView; invite: string }) {
  const [copied, setCopied] = useState(false);
  const i = useI18n();
  const { m, t } = i;
  return (
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">
        {i.rich(m.room.title, { code: <span className="font-mono">{view.code}</span> })}
      </h1>
      <p className="text-muted">
        {t(m.room.settings, {
          rounds: t(m.room.rounds, { n: view.settings.rounds }),
          level: String(view.settings.level) === 'mixed' ? m.room.levelName.mixed : t(m.room.levelName.level, { level: String(view.settings.level) }),
          players: view.members.length,
        })}
      </p>
      {(view.phase === 'lobby' || view.phase === 'finished') && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{m.room.invite}</span>
          <code className="rounded bg-line/50 px-1.5 py-0.5 font-mono">{url}</code>
          <button
            type="button"
            className="rounded border border-line px-2 py-1 hover:bg-line/40"
            onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}
          >
            {copied ? m.room.copied : m.room.copy}
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
  const i = useI18n();
  const { m } = i;
  const me = view.you;
  const act = async (action: string, body: object = {}) => {
    setBusy(true);
    setError(null);
    const res = await post(view.code, action, body);
    setBusy(false);
    if (res.result && res.result !== 'ok') {
      const reason = START_REASON[String(res.result)];
      setError(reason ? m.room.startReason[reason] : m.room.couldNotStart);
    } else if (res.error) setError(m.common.didNotWork);
    return res;
  };
  return (
    <section aria-labelledby="lobby" className="space-y-4">
      <h2 id="lobby" className="text-lg font-semibold">
        {view.phase === 'finished' ? m.room.nextMatch : m.room.players}
      </h2>
      <ul className="space-y-1">
        {view.members.map((member) => (
          <li key={member.name} className="flex flex-wrap items-center gap-2">
            <span className={member.you ? 'font-semibold' : ''}>{member.name}</span>
            {member.host && <span className="rounded bg-line/50 px-1.5 text-xs">{m.room.host}</span>}
            {member.ready ? <span className="text-sm text-good">{m.room.ready}</span> : <span className="text-sm text-muted">{m.room.notReady}</span>}
            {member.away && <span className="text-sm text-muted">{m.room.away}</span>}
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
            {!engineReady ? m.common.loadingEditor : me.ready ? m.room.notReadyButton : m.room.imReady}
          </button>
          {(me.host || view.start.allowed) && (
            <button
              type="button"
              disabled={busy || !view.start.allowed}
              onClick={() => void act('start')}
              className="rounded bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-50"
            >
              {m.room.startMatch}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void act('leave').then(() => router.push(i.href('/rooms')))}
            className="rounded px-2 py-2 text-sm text-muted underline"
          >
            {m.room.leave}
          </button>
        </div>
      )}
      {!view.start.allowed && view.start.reason && START_REASON[view.start.reason] && (
        <p className="text-sm text-muted">{m.room.startReason[START_REASON[view.start.reason]!]}</p>
      )}
      <p role="status" className="min-h-6 text-bad">
        {error}
      </p>
    </section>
  );
}

function RoundTitle({ match, round }: { match: MatchView; round: RoundView }) {
  const { m, t } = useI18n();
  return (
    <p className="text-sm text-muted">
      {t(m.room.roundTitle, {
        round: round.number,
        rounds: match.rounds,
        level: round.level,
        base: round.base,
        bonus: round.base / 4,
        seconds: Math.round(round.referenceMs / 1000),
      })}
    </p>
  );
}

function Countdown({ match, round, now }: { match: MatchView; round: RoundView; now: number }) {
  const { m, t } = useI18n();
  return (
    <section className="space-y-3" aria-live="polite">
      <RoundTitle match={match} round={round} />
      <p className="text-3xl font-semibold">{t(m.room.startsIn, { round: round.number, seconds: Math.max(0, Math.ceil((round.startsAt - now) / 1000)) })}</p>
      <p className="text-muted">{m.room.appears}</p>
    </section>
  );
}

function Statuses({ round }: { round: RoundView }) {
  const { m } = useI18n();
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {round.statuses.map((s) => (
        <li key={s.name}>
          <span className={s.you ? 'font-semibold' : ''}>{s.name}</span>{' '}
          <span className={s.status === 'solved' ? 'text-good' : 'text-muted'}>{m.room.status[s.status]}</span>
          {s.away && <span className="text-muted"> {m.room.away}</span>}
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
  const { m } = useI18n();
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
      waiting={m.room.waiting}
    />
  );
}

function RoundResults({ result }: { result: RoundResult }) {
  const i = useI18n();
  const { m, t } = i;
  return (
    <table className="w-full border-collapse text-left">
      <caption className="pb-2 text-left font-semibold">
        {t(m.room.roundResult, { round: result.number, title: result.title })}{' '}
        <span className="font-normal text-muted">{t(m.room.levelParen, { level: result.level })}</span>
      </caption>
      <thead>
        <tr className="text-sm text-muted">
          <th className="py-1 pr-4 font-normal">{m.room.player}</th>
          <th className="py-1 pr-4 font-normal">{m.room.result}</th>
          <th className="py-1 pr-4 font-normal">{m.room.time}</th>
          <th className="py-1 font-normal">{m.room.points}</th>
        </tr>
      </thead>
      <tbody>
        {result.results.map((r) => (
          <tr key={r.name} className="border-t border-line">
            <td className={`py-1.5 pr-4 ${r.you ? 'font-semibold' : ''}`}>{r.name}</td>
            <td className="py-1.5 pr-4">{m.room.status[r.status]}</td>
            <td className="py-1.5 pr-4 font-mono">{r.ms !== undefined ? i.seconds(r.ms) : '–'}</td>
            <td className="py-1.5 font-mono">{r.status === 'solved' ? `${r.base} + ${r.bonus} = ${r.base + r.bonus}` : '0'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Standings({ match, final }: { match: MatchView; final?: boolean }) {
  const { m, t } = useI18n();
  return (
    <table className="w-full border-collapse text-left">
      <caption className="pb-2 text-left font-semibold">{final ? m.room.finalStandings : m.room.standings}</caption>
      <thead>
        <tr className="text-sm text-muted">
          <th className="py-1 pr-4 font-normal">{m.room.place}</th>
          <th className="py-1 pr-4 font-normal">{m.room.player}</th>
          <th className="py-1 pr-4 font-normal">{m.room.points}</th>
          <th className="py-1 pr-4 font-normal">{m.room.solves}</th>
          <th className="py-1 font-normal">{m.room.timeOnSolves}</th>
        </tr>
      </thead>
      <tbody>
        {match.standings.map((s) => (
          <tr key={s.name} className="border-t border-line">
            <td className="py-1.5 pr-4 font-mono">{s.rank}</td>
            <td className={`py-1.5 pr-4 ${s.you ? 'font-semibold' : ''}`}>{s.name}</td>
            <td className="py-1.5 pr-4 font-mono">{s.points}</td>
            <td className="py-1.5 pr-4 font-mono">{s.solves}</td>
            <td className="py-1.5 font-mono">{t(m.common.seconds, { n: s.seconds })}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Break({ match, round, now }: { match: MatchView; round: RoundView; now: number }) {
  const last = match.past.at(-1);
  const { m, t } = useI18n();
  return (
    <section className="space-y-6" aria-live="polite">
      <p className="text-2xl font-semibold">{t(m.room.startsIn, { round: round.number, seconds: Math.max(0, Math.ceil((round.startsAt - now) / 1000)) })}</p>
      <RoundTitle match={match} round={round} />
      {last && <RoundResults result={last} />}
      <Standings match={match} />
    </section>
  );
}

function Final({ match }: { match: MatchView }) {
  const i = useI18n();
  const { m, t } = i;
  return (
    <section className="space-y-6">
      <h2 className="text-xl font-semibold">{t(m.room.matchOver, { n: match.number })}</h2>
      <Standings match={match} final />
      {match.past.map((r) => (
        <div key={r.number} className="space-y-2">
          <RoundResults result={r} />
          <p className="text-sm">
            <Link href={i.href(`/tasks/${r.taskId}?text=${r.text}`)} className="underline">
              {t(m.room.practise, { title: r.title })}
            </Link>
          </p>
        </div>
      ))}
      <p className="text-sm text-muted">
        {m.room.ties}
      </p>
    </section>
  );
}
