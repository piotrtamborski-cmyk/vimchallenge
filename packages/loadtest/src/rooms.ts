/**
 * A load test for live rooms: simulated players in rooms of eight play match after match against a
 * running site, as the launch plan asks (10 rooms of 8 players for 30 minutes on the test server).
 *
 *   node --disable-warning=ExperimentalWarning packages/loadtest/src/rooms.ts --url http://test-box:3100 \
 *     [--rooms 10] [--players 8] [--minutes 30] [--rounds 5] [--level mixed] \
 *     [--client-header x-loadtest-client] [--out result.json]
 *
 * Each player is a guest with a token of its own. Like the room page, it keeps the room's event
 * stream open, types the published solution of each round's task (a key every 80 to 200 ms, sent
 * in packets every 250 ms) and checks it. Some players check too early once and get "not yet",
 * and some skip a round.
 *
 * Measured, on the machine running the test:
 * - check: from sending a complete run to its verdict (target: 95% within 500 ms);
 * - delivery: from a solver's check to the moment each other player's stream shows the solve. It
 *   includes the judging, so it is an upper bound for the publication alone (target: 95% within 1 s);
 * - packet: a key packet's round trip; errors and reconnects by kind.
 *
 * The site limits room creation and joining per client address, so one machine can create only a
 * few rooms quickly. With --client-header every player sends an address of its own in that header;
 * the site uses it only when CLIENT_IP_HEADER names the header, which only a test server may do.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseKeys } from '@vimchallenge/engine';
import type { RoomView, RoundView } from '@vimchallenge/rooms';
import { onText, taskById } from '@vimchallenge/tasks';
import { Recorder, sseMessages, type Summary } from './stats.ts';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    rooms: { type: 'string', default: '10' },
    players: { type: 'string', default: '8' },
    minutes: { type: 'string', default: '30' },
    rounds: { type: 'string', default: '5' },
    level: { type: 'string', default: 'mixed' },
    'client-header': { type: 'string' },
    out: { type: 'string' },
  },
});
if (!args.url) {
  console.error('usage: rooms.ts --url <site> [--rooms 10] [--players 8] [--minutes 30] [--rounds 5] [--level mixed] [--client-header <name>] [--out <file>]');
  process.exit(2);
}

const site = new URL(args.url);
const ROOMS = Number(args.rooms);
const PLAYERS = Number(args.players);
const DURATION_MS = Number(args.minutes) * 60_000;
const ROUNDS = Number(args.rounds);
const LEVEL = args.level!;
const CLIENT_HEADER = args['client-header'];
const GUEST_COOKIE = site.protocol === 'https:' ? '__Host-vc_guest' : 'vc_guest';
const TARGET = { check: 500, delivery: 1000 };

const rec = new Recorder();
const started = Date.now();
const endsAt = started + DURATION_MS;
let stopping = false;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const between = (min: number, max: number) => min + randomInt(max - min + 1);

/** When each solving check was sent, and when the other players' streams showed the solve. */
const solves = new Map<string, { checkedAt?: number; seenAt: number[] }>();
const solveEntry = (key: string) => {
  let e = solves.get(key);
  if (!e) solves.set(key, (e = { seenAt: [] }));
  return e;
};

class Player {
  readonly name: string;
  readonly token = randomBytes(32).toString('base64url');
  readonly address: string;
  view?: RoomView;
  /** Server time minus local time, from the latest view. */
  offset = 0;
  private stream?: AbortController;
  private closed = false;
  private played = new Set<string>();
  private seen = new Set<string>();
  private firstView?: () => void;
  readonly ready: Promise<void>;

  readonly behaviour: 'steady' | 'early' | 'skipper';

  constructor(room: number, index: number, behaviour: 'steady' | 'early' | 'skipper') {
    this.behaviour = behaviour;
    this.name = `bot-r${String(room + 1).padStart(2, '0')}-p${index + 1}`;
    this.address = `10.99.${room}.${index + 1}`;
    this.ready = new Promise((r) => (this.firstView = r));
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      cookie: `${GUEST_COOKIE}=${this.token}`,
      origin: site.origin,
      ...(CLIENT_HEADER ? { [CLIENT_HEADER]: this.address } : {}),
      ...extra,
    };
  }

  /** A form post, as the room pages send them; returns where the site redirects. */
  async form(path: string, fields: Record<string, string>): Promise<string> {
    const res = await fetch(new URL(path, site), {
      method: 'POST',
      redirect: 'manual',
      headers: this.headers({ 'content-type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams(fields),
    });
    await res.arrayBuffer();
    if (res.status !== 303) throw new Error(`${path}: HTTP ${res.status}`);
    const to = new URL(res.headers.get('location') ?? '/', site);
    return to.pathname + to.search;
  }

  /** A JSON action in the room, timed under `measure`. */
  async act(code: string, action: string, body: object = {}, measure?: string): Promise<Record<string, unknown>> {
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(new URL(`/api/rooms/${code}/${action}`, site), {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body),
      });
    } catch (err) {
      rec.count(`${action}: network error`);
      return { error: (err as Error).message };
    }
    const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (measure) rec.sample(measure, performance.now() - t0);
    if (res.status === 429) rec.count(`${action}: 429`);
    else if (res.status >= 500) rec.count(`${action}: HTTP ${res.status}`);
    return out;
  }

  /** Keeps the room's event stream open, reconnecting after a second when it drops. */
  async listen(code: string): Promise<void> {
    while (!stopping && !this.closed) {
      this.stream = new AbortController();
      try {
        const res = await fetch(new URL(`/api/rooms/${code}/events`, site), { headers: this.headers(), signal: this.stream.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of res.body) {
          const at = Date.now();
          const { events, rest } = sseMessages(buffer + decoder.decode(chunk, { stream: true }));
          buffer = rest;
          for (const e of events) if (e.event === 'message') this.onView(code, JSON.parse(e.data) as RoomView, at);
        }
      } catch (err) {
        if (stopping || this.closed) return;
        if ((err as Error).name !== 'AbortError') rec.count(`stream: ${(err as Error).message}`);
      }
      if (stopping || this.closed) return;
      rec.count('stream: reconnect');
      await sleep(1000);
    }
  }

  close(): void {
    this.closed = true;
    this.stream?.abort();
  }

  private onView(code: string, view: RoomView, at: number): void {
    this.view = view;
    this.offset = view.now - at;
    this.firstView?.();
    this.firstView = undefined;
    const match = view.match;
    if (!match) return;
    // Solves by others, in the round under way or in the results of the rounds before.
    const shown = [
      ...(match.round?.statuses.filter((s) => !s.you && s.status === 'solved').map((s) => [match.round!.number, s.name] as const) ?? []),
      ...match.past.flatMap((r) => r.results.filter((s) => !s.you && s.status === 'solved').map((s) => [r.number, s.name] as const)),
    ];
    for (const [round, name] of shown) {
      const key = `${code}:${match.number}:${round}:${name}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      solveEntry(key).seenAt.push(at);
    }
    const round = match.round;
    if (round?.task && round.mine?.status === 'open') {
      const key = `${match.number}:${round.number}`;
      if (!this.played.has(key)) {
        this.played.add(key);
        void this.play(code, match.number, round);
      }
    }
  }

  private async play(code: string, matchNumber: number, round: RoundView): Promise<void> {
    const task = taskById(round.task!.id);
    if (!task || task.version !== round.task!.version) {
      rec.count('task differs from this copy of the bank');
      return;
    }
    const keys = parseKeys(onText(task, round.task!.text)!.keys);
    // The round starts on the server's clock.
    await sleep(round.startsAt - this.offset - Date.now() + between(1500, 5000));
    if (this.behaviour === 'skipper' && randomInt(3) === 0) {
      const out = await this.act(code, 'skip', { round: round.number });
      rec.count(`skip: ${String(out.result)}`);
      return;
    }
    let sent = 0;
    let typed = 0;
    const send = async () => {
      if (typed <= sent) return;
      const packet = keys.slice(sent, typed);
      const out = await this.act(code, 'keys', { round: round.number, from: sent, keys: packet }, 'packet');
      if (out.ok === true) sent = Number(out.have);
      else rec.count(`keys: ${String(out.error)}`);
    };
    const flusher = setInterval(() => void send(), 250);
    const check = async (count: number) => {
      const checkedAt = Date.now();
      const out = await this.act(code, 'check', { round: round.number, count }, 'check');
      return { result: String(out.result), out, checkedAt };
    };
    try {
      const half = Math.max(1, Math.floor(keys.length / 2));
      for (; typed < keys.length; typed++) {
        if (this.behaviour === 'early' && typed === half && keys.length > 2) {
          await send();
          const early = await check(half);
          rec.count(`early check: ${early.result}`);
        }
        await sleep(between(80, 200));
      }
      typed = keys.length;
      await send();
      let final = await check(keys.length);
      if (final.result === 'error' && final.out.error === 'missing-keys') {
        await send();
        final = await check(keys.length);
      }
      rec.count(`check: ${final.result}${final.result === 'error' ? ` ${String(final.out.error)}` : ''}`);
      if (final.result === 'solved') solveEntry(`${code}:${matchNumber}:${round.number}:${this.name}`).checkedAt = final.checkedAt;
    } finally {
      clearInterval(flusher);
    }
  }
}

async function createRoom(host: Player): Promise<string> {
  for (;;) {
    const to = await host.form('/api/rooms', { name: host.name, rounds: String(ROUNDS), level: LEVEL });
    const code = /^\/rooms\/([a-z0-9]+)$/.exec(to)?.[1];
    if (code) return code;
    if (!to.includes('error=rate')) throw new Error(`creating a room: ${to}`);
    rec.count('create: rate limited');
    console.log(`${host.name}: room creation is rate limited; trying again in 60 s (see --client-header)`);
    await sleep(60_000);
  }
}

async function runRoom(r: number): Promise<void> {
  const players = Array.from({ length: PLAYERS }, (_, i) => new Player(r, i, i === 3 ? 'early' : i === 6 ? 'skipper' : 'steady'));
  const [host] = players as [Player];
  const code = await createRoom(host);
  for (const p of players.slice(1)) {
    const to = await p.form(`/api/rooms/${code}/join`, { name: p.name });
    if (to !== `/rooms/${code}`) throw new Error(`${p.name} joining ${code}: ${to}`);
  }
  for (const p of players) void p.listen(code);
  await Promise.all(players.map((p) => p.ready));
  console.log(`room ${r + 1}: ${code}, ${players.length} players`);

  let matches = 0;
  while (!stopping && Date.now() < endsAt) {
    await Promise.all(players.map((p) => p.act(code, 'ready', { ready: true })));
    let result = '';
    for (let tries = 0; tries < 10 && result !== 'ok'; tries++) {
      result = String((await host.act(code, 'start')).result);
      if (result !== 'ok') await sleep(1000);
    }
    if (result !== 'ok') {
      rec.count(`start: ${result}`);
      await sleep(5000);
      continue;
    }
    const number = ++matches;
    // The match is over when the host's view says so.
    while (!stopping && !(host.view?.phase === 'finished' && host.view.match?.number === number)) await sleep(500);
    rec.count('matches finished');
    await sleep(3000);
  }
  await Promise.all(players.map((p) => p.act(code, 'leave')));
  for (const p of players) p.close();
}

const fmt = (s: Summary) => `n=${s.count} p50=${s.p50.toFixed(0)} p95=${s.p95.toFixed(0)} p99=${s.p99.toFixed(0)} max=${s.max.toFixed(0)} ms`;

function deliveries(): number[] {
  return [...solves.values()].flatMap((e) => (e.checkedAt === undefined ? [] : e.seenAt.map((t) => t - e.checkedAt!)));
}

function report(final: boolean): void {
  const mins = ((Date.now() - started) / 60_000).toFixed(1);
  const lines = [
    `${final ? 'Result' : 'Progress'} after ${mins} min, ${ROOMS} rooms × ${PLAYERS} players:`,
    `  check     ${fmt(rec.summary('check'))}`,
    `  delivery  ${fmt(summaryOf(deliveries()))}`,
    `  packet    ${fmt(rec.summary('packet'))}`,
    ...[...rec.counts].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `  ${k}: ${v}`),
  ];
  console.log(lines.join('\n'));
}

const summaryOf = (samples: number[]) => {
  const r = new Recorder();
  for (const s of samples) r.sample('x', s);
  return r.summary('x');
};

async function health(): Promise<unknown> {
  try {
    return await (await fetch(new URL('/api/health', site))).json();
  } catch (err) {
    return { error: (err as Error).message };
  }
}

const before = await health();
console.log(`${site.origin}: ${JSON.stringify(before)}`);
const progress = setInterval(() => report(false), 30_000);
const stop = () => {
  if (stopping) process.exit(1);
  console.log('stopping after the matches under way…');
  stopping = true;
};
process.on('SIGINT', stop);

const results = await Promise.allSettled(Array.from({ length: ROOMS }, (_, r) => runRoom(r)));
stopping = true;
clearInterval(progress);
for (const [r, res] of results.entries()) if (res.status === 'rejected') console.log(`room ${r + 1} failed: ${(res.reason as Error).message}`);

report(true);
const check = rec.summary('check');
const delivery = summaryOf(deliveries());
const verdicts = [
  `check p95 ${check.p95.toFixed(0)} ms ${check.count && check.p95 <= TARGET.check ? '≤' : '>'} ${TARGET.check} ms: ${check.count && check.p95 <= TARGET.check ? 'met' : 'NOT met'}`,
  `delivery p95 ${delivery.p95.toFixed(0)} ms ${delivery.count && delivery.p95 <= TARGET.delivery ? '≤' : '>'} ${TARGET.delivery} ms: ${delivery.count && delivery.p95 <= TARGET.delivery ? 'met' : 'NOT met'}`,
];
console.log(verdicts.join('\n'));
if (args.out) {
  const after = await health();
  writeFileSync(
    args.out,
    JSON.stringify(
      {
        site: site.origin,
        started: new Date(started).toISOString(),
        minutes: (Date.now() - started) / 60_000,
        rooms: ROOMS,
        players: PLAYERS,
        rounds: ROUNDS,
        level: LEVEL,
        health: { before, after },
        check,
        delivery,
        packet: rec.summary('packet'),
        counts: Object.fromEntries(rec.counts),
        failedRooms: results.flatMap((res, r) => (res.status === 'rejected' ? [{ room: r + 1, error: (res.reason as Error).message }] : [])),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`written ${args.out}`);
}
process.exit(results.some((r) => r.status === 'rejected') ? 1 : 0);
