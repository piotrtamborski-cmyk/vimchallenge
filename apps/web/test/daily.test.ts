/** Daily challenge endpoints against an in-memory database and a fake judge (a run passes when its last key is Z). */
import { Accounts, openDatabase } from '@vimchallenge/accounts';
import { Daily, type DailyView } from '@vimchallenge/daily';
import { describe, expect, it } from 'vitest';
import type { AuthContext } from '../lib/auth/context.ts';
import { accountAction } from '../lib/auth/routes.ts';
import { dailyAction, dailyState } from '../lib/daily/routes.ts';

const SITE = 'https://vimchallenge.test';

function site() {
  let now = Date.parse('2026-05-31T12:00:00Z');
  const accounts = new Accounts(openDatabase(':memory:'), () => now);
  const auth: AuthContext = { config: { publicUrl: new URL(SITE), secure: true, databasePath: ':memory:' }, accounts };
  const daily = new Daily(accounts.db, {
    now: () => now,
    random: () => 0,
    judge: async (job) => (job.keys.at(-1) === 'Z' ? { verdict: 'passed', judgeVersion: 1 } : { verdict: 'failed', failures: [] }),
    onSolved: (userId, s) => accounts.recordSolve(userId, s),
  });
  const ctx = { auth, daily };

  const player = (name?: string) => {
    let cookie = '';
    let id: string | undefined;
    if (name) {
      const signedIn = accounts.signIn({ provider: 'email', subject: `${name}@example.com`, email: `${name}@example.com` });
      if (!signedIn.ok) throw new Error(signedIn.error);
      id = signedIn.user.id;
      cookie = `__Host-vc_session=${accounts.createSession(id)}`;
    }
    const request = (path: string, init: RequestInit & { origin?: string; type?: string } = {}) =>
      new Request(SITE + path, {
        ...init,
        headers: { cookie, ...(init.method === 'POST' ? { origin: init.origin ?? SITE, 'content-type': init.type ?? 'application/json' } : {}) },
      });
    const act = async (action: string, body: unknown = {}, init: { origin?: string; type?: string } = {}) =>
      dailyAction(request(`/api/daily/${action}`, { method: 'POST', body: JSON.stringify(body), ...init }), ctx, action);
    const state = async () => (await dailyState(request('/api/daily'), ctx).json()) as DailyView;
    return { id, act, state, request };
  };
  return { ctx, accounts, daily, player, clock: { advance: (ms: number) => (now += ms) } };
}

describe('daily challenge endpoints', () => {
  it('shows the set to anyone, and lets only a signed-in player act, from this site, with JSON', async () => {
    const s = site();
    const guest = s.player();
    const view = await guest.state();
    expect(view.today).toBe('2026-05-31');
    expect(view.set.tasks).toHaveLength(5);
    expect(view.you).toBeUndefined();
    // Nothing of the tasks themselves before a run.
    expect(JSON.stringify(view)).not.toMatch(/prompt|initial|expected/);
    expect((await guest.act('start')).status).toBe(401);

    const alice = s.player('alice');
    expect((await alice.act('start', {}, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await alice.act('start', {}, { type: 'text/plain' })).status).toBe(415);
    expect((await alice.act('nope')).status).toBe(404);
  });

  it('plays a run: start, keys, check, next, skip', async () => {
    const s = site();
    const alice = s.player('alice');
    const started = (await (await alice.act('start', { boards: true })).json()) as { ok: boolean; view: DailyView };
    expect(started.ok).toBe(true);
    const run = started.view.you!.run!;
    expect(run.current).toMatchObject({ position: 1, task: { title: expect.any(String) } });
    expect(s.accounts.onBoards(alice.id!)).toBe(true);

    s.clock.advance(5_000);
    expect(await (await alice.act('keys', { day: run.day, position: 1, from: 0, keys: ['Z'] })).json()).toEqual({ ok: true, have: 1 });
    expect(await (await alice.act('check', { day: run.day, position: 1, count: 1 })).json()).toMatchObject({ result: 'solved', ms: 5_000, base: 100 });
    expect(s.accounts.progress(alice.id!).size).toBe(1);

    const next = (await (await alice.act('next', { day: run.day })).json()) as { result: string; view: DailyView };
    expect(next.result).toBe('ok');
    expect(next.view.you!.run!.current!.position).toBe(2);
    expect(await (await alice.act('skip', { day: run.day, position: 2 })).json()).toEqual({ result: 'skipped' });
    expect((await alice.state()).you!.run!.tasks.map((t) => t.status)).toEqual(['solved', 'skipped', 'not-reached', 'not-reached', 'not-reached']);

    // A second start the same day changes nothing.
    expect((await (await alice.act('start', { boards: false })).json()).ok).toBe(true);
    expect(s.accounts.onBoards(alice.id!)).toBe(true);
  });

  it('keeps the name off the public tables when the player says so on the account page', async () => {
    const s = site();
    const alice = s.player('alice');
    await alice.act('start', { boards: true });
    expect(s.daily.board('day', '2026-05-31')!.rows).toHaveLength(1);
    const form = (body: Record<string, string>) =>
      accountAction(alice.request('/api/account/boards', { method: 'POST', body: new URLSearchParams(body), type: 'application/x-www-form-urlencoded' }), s.ctx.auth, 'boards');
    const hidden = await form({});
    expect(new URL(hidden.headers.get('location')!).search).toBe('?notice=boards-hidden');
    expect(s.daily.board('day', '2026-05-31')!.rows).toHaveLength(0);
    expect(s.daily.board('day', '2026-05-31', alice.id)!.you).toMatchObject({ rank: 1, listed: false });
    await form({ boards: 'on' });
    expect(s.daily.board('day', '2026-05-31')!.rows).toHaveLength(1);
  });
});
