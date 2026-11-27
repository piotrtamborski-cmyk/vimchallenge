/** Room endpoints against an in-memory database and a fake judge (a run passes when its last key is Z). */
import { Accounts, openDatabase } from '@vimchallenge/accounts';
import { Rooms, type RoomView } from '@vimchallenge/rooms';
import { describe, expect, it } from 'vitest';
import type { AuthContext } from '../lib/auth/context.ts';
import type { Watcher } from '../lib/rooms/hub.ts';
import { createRoom, roomAction, roomEvents, roomState } from '../lib/rooms/routes.ts';

const SITE = 'https://vimchallenge.test';
let clients = 0;

function site() {
  let now = 1_900_000_000_000;
  const accounts = new Accounts(openDatabase(':memory:'), () => now);
  const auth: AuthContext = { config: { publicUrl: new URL(SITE), secure: true, databasePath: ':memory:' }, accounts };
  const rooms = new Rooms(accounts.db, {
    now: () => now,
    judge: async (job) => (job.keys.at(-1) === 'Z' ? { verdict: 'passed', judgeVersion: 1 } : { verdict: 'failed', failures: [] }),
    onSolved: (userId, s) => accounts.recordSolve(userId, s),
  });
  const notified: string[] = [];
  const ctx = { auth, rooms, notify: (code: string) => void notified.push(code) };

  /** A browser: its own cookies and address. */
  const browser = () => {
    const cookies: Record<string, string> = {};
    const ip = `198.51.100.${++clients}`;
    const keep = (res: Response) => {
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split('; ');
        const [k, v] = pair!.split('=') as [string, string];
        cookies[k] = v;
      }
      return res;
    };
    const headers = (extra: Record<string, string>) => ({
      'x-forwarded-for': ip,
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
      ...extra,
    });
    const form = (path: string, body: Record<string, string>, origin = SITE) =>
      new Request(SITE + path, { method: 'POST', headers: headers({ origin, 'content-type': 'application/x-www-form-urlencoded' }), body: new URLSearchParams(body) });
    const json = (path: string, body: unknown) =>
      new Request(SITE + path, { method: 'POST', headers: headers({ origin: SITE, 'content-type': 'application/json' }), body: JSON.stringify(body) });
    const get = (path: string) => new Request(SITE + path, { headers: headers({}) });
    const act = async (code: string, action: string, body: unknown = {}) => (await roomAction(json(`/api/rooms/${code}/${action}`, body), ctx, code, action)).json();
    const view = async (code: string) => (await roomState(get(`/api/rooms/${code}`), ctx, code)).json() as Promise<RoomView>;
    return { cookies, keep, form, json, get, act, view };
  };
  return { ctx, accounts, rooms, notified, browser, clock: { advance: (ms: number) => (now += ms) } };
}

const where = (res: Response) => new URL(res.headers.get('location')!).pathname + new URL(res.headers.get('location')!).search;

async function twoPlayers() {
  const s = site();
  const alice = s.browser();
  const bob = s.browser();
  const created = alice.keep(await createRoom(alice.form('/api/rooms', { name: 'alice', rounds: '1', level: '1' }), s.ctx));
  const code = where(created).split('/').at(-1)!;
  bob.keep(await roomAction(bob.form(`/api/rooms/${code}/join`, { name: 'bob' }), s.ctx, code, 'join'));
  return { s, alice, bob, code, created };
}

describe('rooms over HTTP', () => {
  it('creates a room for a guest, with a guest cookie, and lets another guest join', async () => {
    const { s, alice, bob, code, created } = await twoPlayers();
    expect(created.status).toBe(303);
    expect(code).toMatch(/^[a-z0-9]{10}$/);
    expect(created.headers.getSetCookie()[0]).toMatch(/^__Host-vc_guest=[\w-]{43}; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure$/);
    expect(s.notified).toEqual([code]);
    expect((await alice.view(code)).members.map((m) => [m.name, m.you])).toEqual([
      ['alice', true],
      ['bob', false],
    ]);
    expect((await bob.view(code)).you?.name).toBe('bob');
    // A stranger sees the room but is not in it.
    expect((await s.browser().view(code)).you).toBeUndefined();
  });

  it('refuses bad names, foreign origins and unknown rooms', async () => {
    const s = site();
    const b = s.browser();
    expect(where(await createRoom(b.form('/api/rooms', { name: 'x', rounds: '3', level: 'mixed' }), s.ctx))).toBe('/rooms?error=name-invalid');
    expect(where(await createRoom(b.form('/api/rooms', { name: 'abc', rounds: '9', level: 'mixed' }), s.ctx))).toBe('/rooms?error=settings');
    expect((await createRoom(b.form('/api/rooms', { name: 'abc', rounds: '3', level: 'mixed' }, 'https://evil.example'), s.ctx)).status).toBe(403);
    expect(where(await roomAction(b.form('/api/rooms/nosuchroom/join', { name: 'abc' }), s.ctx, 'nosuchroom', 'join'))).toBe('/rooms?error=not-found');
    expect((await roomState(b.get('/api/rooms/nosuchroom'), s.ctx, 'nosuchroom')).status).toBe(404);
  });

  it('plays a round: ready, start, keys, check', async () => {
    const { s, alice, bob, code } = await twoPlayers();
    expect(await alice.act(code, 'ready', { ready: true })).toEqual({ ok: true });
    expect(await bob.act(code, 'ready', { ready: true })).toEqual({ ok: true });
    expect(await bob.act(code, 'start')).toEqual({ result: 'not-host' });
    expect(await alice.act(code, 'start')).toEqual({ result: 'ok' });
    s.clock.advance(5_000);
    const round = (await alice.view(code)).match!.round!;
    expect(round.task).toBeDefined();
    expect(await alice.act(code, 'keys', { round: 1, from: 0, keys: ['x', 'Z'] })).toEqual({ ok: true, have: 2 });
    s.clock.advance(3_000);
    expect(await alice.act(code, 'check', { round: 1, count: 2 })).toEqual({ result: 'solved', ms: 3_000, base: 100, bonus: 25 });
    expect(await bob.act(code, 'skip', { round: 1 })).toEqual({ result: 'skipped' });
    const end = await bob.view(code);
    expect(end.phase).toBe('finished');
    expect(end.match!.standings.map((p) => [p.rank, p.name, p.points])).toEqual([
      [1, 'alice', 125],
      [2, 'bob', 0],
    ]);
  });

  it('needs JSON from this site, and a player', async () => {
    const { s, alice, code } = await twoPlayers();
    const asForm = alice.form(`/api/rooms/${code}/ready`, { ready: 'true' });
    expect((await roomAction(asForm, s.ctx, code, 'ready')).status).toBe(415);
    const stranger = s.browser();
    expect((await roomAction(stranger.json(`/api/rooms/${code}/ready`, { ready: true }), s.ctx, code, 'ready')).status).toBe(401);
    const foreign = alice.json(`/api/rooms/${code}/start`, {});
    foreign.headers.set('origin', 'https://evil.example');
    expect((await roomAction(foreign, s.ctx, code, 'start')).status).toBe(403);
  });

  it("saves a signed-in player's solve to their progress", async () => {
    const s = site();
    const signedIn = s.accounts.signIn({ provider: 'github', subject: '7', login: 'octo' });
    if (!signedIn.ok) throw new Error('sign-in failed');
    const user = s.browser();
    user.cookies['__Host-vc_session'] = s.accounts.createSession(signedIn.user.id);
    const guest = s.browser();
    const created = user.keep(await createRoom(user.form('/api/rooms', { name: 'octo', rounds: '1', level: '1' }), s.ctx));
    expect(created.headers.getSetCookie()).toEqual([]);
    const code = where(created).split('/').at(-1)!;
    guest.keep(await roomAction(guest.form(`/api/rooms/${code}/join`, { name: 'guest' }), s.ctx, code, 'join'));
    await user.act(code, 'ready', { ready: true });
    await guest.act(code, 'ready', { ready: true });
    await user.act(code, 'start');
    s.clock.advance(5_000);
    await user.act(code, 'keys', { round: 1, from: 0, keys: ['Z'] });
    await user.act(code, 'check', { round: 1, count: 1 });
    expect(s.accounts.history(signedIn.user.id)).toHaveLength(1);
  });

  it('streams the room as Server-Sent Events', async () => {
    const { s, alice, code } = await twoPlayers();
    const abort = new AbortController();
    const watchers: Watcher[] = [];
    const request = new Request(`${SITE}/api/rooms/${code}/events`, { headers: alice.get('/').headers, signal: abort.signal });
    const res = roomEvents(request, s.ctx, code, (_code, w) => {
      watchers.push(w);
      return () => {};
    });
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toMatch(/^data: \{.*"code":"/);
    expect(JSON.parse(first.slice(6)).you.name).toBe('alice');
    // A change is sent with the view the hub read for this page.
    expect(watchers[0]!.player).toBeDefined();
    watchers[0]!.send(s.ctx.rooms.view(code, watchers[0]!.player));
    expect(new TextDecoder().decode((await reader.read()).value)).toMatch(/^data: /);
    watchers[0]!.send(undefined);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('event: gone\ndata: {}\n\n');
    abort.abort();
    expect((await reader.read()).done).toBe(true);
  });
});
