import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts, openDatabase } from '@vimchallenge/accounts';
import { COUNTDOWN_MS, GRACE_MS, JudgeUnavailable, Rooms, type JudgeVerdict } from '@vimchallenge/rooms';
import { tasks } from '@vimchallenge/tasks';
import { describe, expect, it } from 'vitest';
import { run as admin } from '../src/admin.ts';
import { Daily, KEYS_KEPT_MS, leaguePoints, type Board } from '../src/index.ts';

/**
 * Two tasks per level with reference times picked for easy sums: the time to solve a task
 * (four times its reference, at least a minute) is 60, 80, 160, 200 and 400 seconds, so a run may
 * last 900 seconds; the most a set gives is 125 + 200 + 300 + 450 + 650 = 1725.
 */
const REFERENCE: Record<number, number> = { 1: 12, 2: 20, 3: 40, 4: 50, 5: 100 };
const BANK = [1, 2, 3, 4, 5].flatMap((level) =>
  tasks
    .filter((t) => t.level === level)
    .slice(0, 2)
    .map((t) => ({ ...t, referenceSeconds: REFERENCE[level] })),
);
const S = 1000;

/** A fake clock and a judge that passes a run whose last key is `Z`. */
function setup(start = '2026-05-31T12:00:00Z') {
  let now = Date.parse(start);
  const db = openDatabase(':memory:');
  const accounts = new Accounts(db, () => now);
  const judge = { down: false, calls: 0 };
  const solved: string[] = [];
  const make = () =>
    new Daily(db, {
      now: () => now,
      random: () => 0,
      tasks: BANK,
      judge: async (job): Promise<JudgeVerdict> => {
        judge.calls++;
        if (judge.down) throw new JudgeUnavailable('down');
        return job.keys.at(-1) === 'Z' ? { verdict: 'passed', judgeVersion: 1 } : { verdict: 'failed', failures: [{ field: 'text', want: ['x'], got: ['y'] }] };
      },
      onSolved: (userId, s) => solved.push(`${userId}:${s.taskId}`),
    });
  const daily = make();
  const user = (name: string, options: { email?: boolean } = {}) => {
    const email = options.email ?? true;
    const result = accounts.signIn({ provider: email ? 'email' : 'github', subject: name, email: email ? `${name}@example.com` : null, login: name });
    if (!result.ok) throw new Error(result.error);
    accounts.rename(result.user.id, name);
    return result.user.id;
  };
  const clock = { now: () => now, set: (t: number | string) => (now = typeof t === 'string' ? Date.parse(t) : t), advance: (ms: number) => (now += ms) };
  /** The task being played, for a player. */
  const current = (id: string) => daily.view(id).you!.run!.current!;
  /** Solves the task being played `ms` after it was given. */
  const solveAt = async (id: string, ms: number) => {
    const c = current(id);
    const day = daily.view(id).you!.run!.day;
    clock.set(c.startsAt + ms);
    expect(daily.appendKeys(id, day, c.position, 0, ['Z'])).toEqual({ ok: true, have: 1 });
    return daily.check(id, day, c.position, 1);
  };
  /**
   * Plays a whole run from now: for each task the time to its solve, or null to skip it. The next
   * task is asked for a second after the one before ends.
   */
  const play = async (id: string, plan: (number | null)[], onBoards = true) => {
    expect(daily.start(id, onBoards)).toEqual({ ok: true });
    const day = daily.view(id).you!.run!.day;
    for (const [i, ms] of plan.entries()) {
      if (i > 0) {
        clock.advance(S);
        expect(daily.next(id, day)).toBe('ok');
      }
      const c = current(id);
      if (ms === null) {
        clock.advance(S);
        expect(daily.skip(id, day, c.position)).toBe('skipped');
      } else {
        expect((await solveAt(id, ms)).result).toBe('solved');
      }
    }
    return day;
  };
  const names = (b: Board) => b.rows.map((r) => `${r.rank} ${r.name} ${r.points}`);
  return { db, accounts, daily, make, judge, solved, user, clock, current, solveAt, play, names };
}

describe('the set of the day', () => {
  it('has a task per level, the same for everyone, and does not repeat a task before the others of its level', () => {
    const { daily, user, clock } = setup();
    const a = user('alice');
    const b = user('bob');
    const first = daily.view(a).set;
    expect(first.tasks.map((t) => [t.level, t.base, t.maxPoints, t.availableMs / S])).toEqual([
      [1, 100, 125, 60],
      [2, 160, 200, 80],
      [3, 240, 300, 160],
      [4, 360, 450, 200],
      [5, 520, 650, 400],
    ]);
    expect(first.maxPoints).toBe(1725);
    expect(first.totalMs).toBe(900 * S);
    expect(daily.view(b).set).toEqual(first);

    const ids = (day: string) => (daily.db.prepare('SELECT task_id, text FROM daily_tasks WHERE day = ? ORDER BY position').all(day) as { task_id: string; text: number }[]);
    clock.advance(86_400 * S);
    daily.view();
    clock.advance(86_400 * S);
    daily.view();
    const [d1, d2, d3] = [ids('2026-05-31'), ids('2026-06-01'), ids('2026-06-02')];
    // Day 2 uses the other task of each level; day 3 goes back to the first, on another text.
    expect(d2.every((t, i) => t.task_id !== d1[i]!.task_id)).toBe(true);
    expect(d3.map((t) => t.task_id)).toEqual(d1.map((t) => t.task_id));
    expect(d3.every((t, i) => t.text !== d1[i]!.text)).toBe(true);
  });
});

describe('a run', () => {
  it('gives the tasks one at a time and scores them as worked out by hand', async () => {
    const { daily, user, clock, current, solveAt, solved, db } = setup();
    const a = user('alice');
    const day = '2026-05-31';
    const t0 = clock.now();
    expect(daily.view(a).you).toMatchObject({ eligible: true, onBoards: null });
    expect(daily.start(a, true)).toEqual({ ok: true });
    expect(current(a)).toMatchObject({ position: 1, startsAt: t0, deadline: t0 + 60 * S });
    // Only the task being played is given.
    expect(daily.view(a).you!.run!.tasks.map((t) => t.title !== undefined)).toEqual([true, false, false, false, false]);

    // Task 1 (base 100, reference 12 s) solved after 6 s: the full bonus.
    expect(await solveAt(a, 6 * S)).toEqual({ result: 'solved', ms: 6 * S, base: 100, bonus: 25 });
    expect(daily.next(a, day)).toBe('ok');
    expect(daily.next(a, day)).toBe('busy');
    // Task 2 (base 160, reference 20 s) after 30 s: floor(160 × 10 / 80) = 20.
    expect(await solveAt(a, 30 * S)).toMatchObject({ base: 160, bonus: 20 });
    clock.advance(S);
    daily.next(a, day);
    // Task 3 skipped.
    expect(daily.skip(a, day, current(a).position)).toBe('skipped');
    clock.advance(S);
    daily.next(a, day);
    // Task 4 runs out of time (200 s).
    const t4 = current(a);
    expect(t4.position).toBe(4);
    clock.set(t4.deadline + 1);
    expect(daily.view(a).you!.run!.tasks[3]!.status).toBe('timeout');
    expect(daily.next(a, day)).toBe('ok');
    // Task 5 (base 520, reference 100 s) after 150 s: floor(520 × 50 / 400) = 65.
    expect(await solveAt(a, 150 * S)).toMatchObject({ base: 520, bonus: 65 });

    const run = daily.view(a).you!.run!;
    expect(run.finished).toBe(true);
    expect(run.tasks.map((t) => [t.status, t.earned])).toEqual([
      ['solved', 125],
      ['solved', 180],
      ['skipped', 0],
      ['timeout', 0],
      ['solved', 585],
    ]);
    // 890 of 1725: floor(1000 × 890 / 1725) = 515 league points.
    expect(run).toMatchObject({ points: 890, solves: 3, seconds: 186, maxPoints: 1725, league: 515 });
    expect(leaguePoints(1035, 1725)).toBe(600);
    expect(daily.next(a, day)).toBe('done');
    expect(solved).toHaveLength(3);
    expect(db.prepare('SELECT count(*) AS n FROM daily_entries').get()!.n).toBe(1);
  });

  it('is one per account and day, for accounts with a verified email address', async () => {
    const { daily, user, clock, play } = setup();
    const a = user('alice');
    const g = user('gitless', { email: false });
    expect(daily.start(g, true)).toEqual({ ok: false, error: 'not-eligible' });
    expect(daily.view(g).you!.eligible).toBe(false);

    expect(daily.start(a, false)).toEqual({ ok: true });
    // Pressing start again (another tab) changes nothing.
    expect(daily.start(a, false)).toEqual({ ok: true });
    expect(daily.view(a).you!.run!.current!.position).toBe(1);
    clock.advance(1000 * S);
    expect(daily.view(a).you!.run!.finished).toBe(true);
    expect(daily.start(a, false)).toEqual({ ok: false, error: 'played' });
    expect(daily.view(a).you!.onBoards).toBe(false);

    clock.set('2026-06-01T08:00:00Z');
    await play(a, [5 * S]);
    expect(daily.view(a).you!.yesterday).toEqual({ day: '2026-05-31', points: 0, league: 0, maxPoints: 1725 });
  });

  it('counts a solve once when two tabs check it', async () => {
    const { daily, user, current, clock, solved } = setup();
    const a = user('alice');
    daily.start(a, true);
    const c = current(a);
    clock.advance(10 * S);
    daily.appendKeys(a, '2026-05-31', 1, 0, ['Z']);
    const [x, y] = await Promise.all([daily.check(a, '2026-05-31', c.position, 1), daily.check(a, '2026-05-31', c.position, 1)]);
    expect(x).toEqual(y);
    expect(x).toMatchObject({ result: 'solved', ms: 10 * S });
    expect(solved).toHaveLength(1);
    expect(daily.view(a).you!.run!.solves).toBe(1);
  });

  it('takes keys and a check until the deadline, inclusive', async () => {
    const { daily, user, current, clock } = setup();
    const a = user('alice');
    const b = user('bob');
    const day = '2026-05-31';
    daily.start(a, true);
    daily.start(b, true);
    const deadline = current(a).deadline;

    clock.set(deadline);
    expect(daily.appendKeys(a, day, 1, 0, ['x', 'Z'])).toEqual({ ok: true, have: 2 });
    // A check that leaves out a key the server has is refused with the count.
    expect(await daily.check(a, day, 1, 1)).toEqual({ result: 'error', error: 'missing-keys', have: 2 });
    expect(await daily.check(a, day, 1, 2)).toEqual({ result: 'solved', ms: 60 * S, base: 100, bonus: 0 });

    clock.set(deadline + 1);
    expect(daily.appendKeys(b, day, 1, 0, ['Z'])).toEqual({ ok: false, error: 'closed' });
    expect(await daily.check(b, day, 1, 0)).toEqual({ result: 'closed', status: 'timeout' });
  });

  it('keeps the time of a check received in time while the judge is down, for a short grace', async () => {
    const { daily, user, current, clock, judge } = setup();
    const a = user('alice');
    const b = user('bob');
    const day = '2026-05-31';
    daily.start(a, true);
    daily.start(b, true);
    const deadline = current(a).deadline;
    judge.down = true;
    clock.set(deadline - 2 * S);
    for (const p of [a, b]) {
      daily.appendKeys(p, day, 1, 0, ['Z']);
      expect(await daily.check(p, day, 1, 1)).toEqual({ result: 'error', error: 'judge-unavailable' });
    }
    judge.down = false;
    clock.set(deadline + GRACE_MS - S);
    expect(await daily.check(a, day, 1, 1)).toEqual({ result: 'solved', ms: 58 * S, base: 100, bonus: 0 });
    clock.set(deadline + GRACE_MS + 1);
    expect(await daily.check(b, day, 1, 1)).toEqual({ result: 'closed', status: 'timeout' });
  });

  it('carries on after a restart, with the keys the server has', () => {
    const { daily, make, user, current, clock } = setup();
    const a = user('alice');
    daily.start(a, true);
    clock.advance(3 * S);
    daily.appendKeys(a, '2026-05-31', 1, 0, ['i', 'x']);
    const again = make();
    expect(again.view(a).you!.run!.current).toMatchObject({ position: 1, mine: { keys: ['i', 'x'], status: 'open' } });
    expect(current(a).startsAt).toBe(Date.parse('2026-05-31T12:00:00Z'));
  });

  it('ends with its time even when the player stops asking for tasks', async () => {
    const { daily, user, clock, solveAt } = setup();
    const a = user('alice');
    daily.start(a, true);
    await solveAt(a, 5 * S);
    const run = daily.view(a).you!.run!;
    expect(run.next).toBe(2);
    clock.set(run.endsAt);
    expect(daily.next(a, run.day)).toBe('done');
    expect(daily.view(a).you!.run).toMatchObject({ finished: true, points: 125 });
  });
});

describe('days, weeks and months', () => {
  it('counts a run started a minute before midnight on the last day of a month for that day, week and month', async () => {
    const { daily, user, clock, solveAt, names } = setup('2026-05-31T23:59:00Z');
    const a = user('alice');
    expect(daily.start(a, true)).toEqual({ ok: true });
    await solveAt(a, 6 * S);
    clock.set('2026-06-01T00:00:30Z');
    expect(daily.next(a, '2026-05-31')).toBe('ok');
    await solveAt(a, 10 * S);

    const view = daily.view(a);
    expect(view.today).toBe('2026-06-01');
    expect(view.you!.run!.day).toBe('2026-05-31');
    // The run under way comes first: no second run until it is over.
    expect(daily.start(a, true)).toEqual({ ok: false, error: 'busy' });

    expect(names(daily.board('day', '2026-05-31')!)).toEqual(['1 alice 325']);
    expect(names(daily.board('week', '2026-05-25')!)).toEqual([`1 alice ${leaguePoints(325, 1725)}`]);
    expect(names(daily.board('month', '2026-05')!)).toEqual(['1 alice 188']);
    expect(daily.board('week', '2026-06-01')!.rows).toEqual([]);
    expect(daily.board('month', '2026-06')!.rows).toEqual([]);

    // The day is settled when its last possible run is over: midnight + 900 s + the grace.
    const closes = Date.parse('2026-06-01T00:15:00Z') + GRACE_MS;
    expect(daily.closesAt('2026-05-31')).toBe(closes);
    clock.set(closes - 1);
    expect(daily.board('day', '2026-05-31')!.final).toBe(false);
    clock.set(closes);
    const board = daily.board('day', '2026-05-31')!;
    expect(board.final).toBe(true);
    expect(board.set!.map((t) => t.level)).toEqual([1, 2, 3, 4, 5]);
    expect(daily.board('week', '2026-05-25')!.final).toBe(true);
    // Yesterday's run is over: the page shows today's set, and yesterday's result.
    expect(daily.view(a).you).toMatchObject({ run: undefined, yesterday: { day: '2026-05-31', points: 325, league: 188, maxPoints: 1725 } });
    // Now today's set may be played.
    expect(daily.start(a, true)).toEqual({ ok: true });
  });

  it('ranks the tables: ties share a place, hidden names stay off the public table', async () => {
    const { daily, user, clock, play, names } = setup('2026-05-25T09:00:00Z');
    const a = user('alice');
    const b = user('bob');
    const c = user('carol');
    const d = user('dave');
    // Monday: alice and bob alike, carol slower on the same solves.
    await play(a, [6 * S, 10 * S]);
    await play(b, [6 * S, 10 * S]);
    await play(c, [20 * S, 10 * S]);
    await play(d, [6 * S, 10 * S, 10 * S], false);
    expect(names(daily.board('day', '2026-05-25', a)!)).toEqual(['1 alice 325', '1 bob 325', '3 carol 308']);
    // Tuesday: only carol plays.
    clock.set('2026-05-26T09:00:00Z');
    await play(c, [6 * S, 10 * S]);
    clock.set('2026-06-02T00:00:00Z');

    const week = daily.board('week', '2026-05-25', d)!;
    expect(names(week)).toEqual([`1 carol ${leaguePoints(308, 1725) + leaguePoints(325, 1725)}`, '2 alice 188', '2 bob 188']);
    expect(week.rows.find((r) => r.name === 'carol')!.days).toBe(2);
    // dave keeps his name off the tables, but sees where he would be: behind carol (366 to 362).
    expect(week.you).toMatchObject({ name: 'dave', rank: 2, listed: false, points: leaguePoints(625, 1725) });
    expect(week.final).toBe(true);
    expect(daily.board('month', '2026-05', a)!.you).toMatchObject({ rank: 2, listed: true });
    expect(names(daily.board('all', 'all')!)).toEqual(names(daily.board('month', '2026-05')!));
    expect(daily.board('all', 'all')!.final).toBe(false);
    expect(daily.board('week', '2026-05-26')).toBeUndefined();
  });

  it('corrects a task after the period closed: every table follows, and rebuilding again changes nothing', async () => {
    const { daily, user, clock, play, names, db } = setup('2026-05-25T09:00:00Z');
    const a = user('alice');
    const b = user('bob');
    await play(a, [6 * S, 50 * S]);
    await play(b, [30 * S, 10 * S]);
    clock.set('2026-05-27T09:00:00Z');
    await play(a, [6 * S]);
    clock.set('2026-06-10T00:00:00Z');
    const tables = () => [daily.board('day', '2026-05-25')!, daily.board('week', '2026-05-25')!, daily.board('month', '2026-05')!, daily.board('all', 'all')!].map(names);
    // alice 125 + 160 = 285, bob 100 + 200 = 300 on Monday.
    expect(tables()[0]).toEqual(['1 bob 300', '2 alice 285']);

    // Task 2 of Monday was faulty: out it goes, for everyone.
    expect(daily.correct('2026-05-25', 2, 'void', 'wrong expected text')).toBe('ok');
    expect(daily.correct('2026-05-25', 2, 'void', 'again')).toBe('unchanged');
    const corrected = tables();
    expect(corrected[0]).toEqual(['1 alice 125', '2 bob 100']);
    const monday = daily.board('day', '2026-05-25', a)!;
    expect(monday.you).toMatchObject({ league: leaguePoints(125, 1525) });
    expect(corrected[1]).toEqual([`1 alice ${leaguePoints(125, 1525) + leaguePoints(125, 1725)}`, `2 bob ${leaguePoints(100, 1525)}`]);
    const [correction] = daily.corrections('2026-05-25');
    expect(correction).toMatchObject({ position: 2, action: 'void', reason: 'wrong expected text' });
    expect(correction!.before.map((e) => e.points).sort()).toEqual([285, 300]);

    daily.rebuild('2026-05-25');
    daily.rebuild('2026-05-25');
    expect(tables()).toEqual(corrected);

    // A day without any task that counts is cancelled and left out of every table.
    for (const p of [1, 3, 4, 5]) daily.correct('2026-05-25', p, 'void', 'server fault');
    expect(db.prepare('SELECT cancelled_at FROM daily_sets WHERE day = ?').get('2026-05-25')!.cancelled_at).not.toBeNull();
    expect(daily.board('day', '2026-05-25')!.rows).toEqual([]);
    expect(names(daily.board('week', '2026-05-25')!)).toEqual([`1 alice ${leaguePoints(125, 1725)}`]);
    daily.correct('2026-05-25', 1, 'restore', 'task 1 was fine');
    expect(daily.board('day', '2026-05-25')!.rows.map((r) => r.name)).toEqual(['alice', 'bob']);
  });

  it('skips a voided task in runs that have not reached it', async () => {
    const { daily, user, play } = setup();
    const a = user('alice');
    daily.view();
    expect(daily.correct('2026-05-31', 2, 'void', 'faulty')).toBe('ok');
    await play(a, [6 * S, 6 * S, null, null]);
    const run = daily.view(a).you!.run!;
    expect(run.tasks.map((t) => t.status)).toEqual(['solved', 'not-reached', 'solved', 'skipped', 'skipped']);
    expect(run.maxPoints).toBe(1525);
  });
});

describe('what the daily challenge keeps', () => {
  it('deletes the keys a week after the day is settled, and the runs with the account', async () => {
    const { daily, accounts, user, clock, play, db } = setup();
    const a = user('alice');
    await play(a, [6 * S]);
    const keys = () => db.prepare('SELECT keys, key_count FROM daily_attempts WHERE position = 1').get();
    clock.set(daily.closesAt('2026-05-31'));
    daily.view();
    clock.set(daily.closesAt('2026-05-31') + KEYS_KEPT_MS - 1);
    daily.view();
    expect(keys()).toEqual({ keys: '["Z"]', key_count: 1 });
    clock.set(daily.closesAt('2026-05-31') + KEYS_KEPT_MS + 3_600_000);
    daily.view();
    expect(keys()).toEqual({ keys: '[]', key_count: 1 });

    accounts.deleteUser(a);
    expect(db.prepare('SELECT count(*) AS n FROM daily_runs').get()!.n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM daily_entries').get()!.n).toBe(0);
  });

  it('adds nothing to the league from rooms', async () => {
    const { db, user, clock } = setup();
    const a = user('alice');
    const rooms = new Rooms(db, { now: clock.now, random: () => 0, tasks: BANK, judge: async () => ({ verdict: 'passed' }) });
    const created = rooms.create({ id: `u:${a}`, userId: a }, 'alice', { rounds: 1, level: '1' });
    if (!created.ok) throw new Error(created.error);
    const A = { id: `u:${a}`, userId: a };
    const B = { id: 'g:bob' };
    rooms.join(created.code, B, 'bob');
    rooms.setReady(created.code, A, true);
    rooms.setReady(created.code, B, true);
    expect(rooms.start(created.code, A)).toBe('ok');
    clock.advance(COUNTDOWN_MS + 5 * S);
    rooms.appendKeys(created.code, A, 1, 0, ['Z']);
    expect((await rooms.check(created.code, A, 1, 1)).result).toBe('solved');
    expect(db.prepare('SELECT count(*) AS n FROM daily_entries').get()!.n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM daily_runs').get()!.n).toBe(0);
  });
});

describe('the admin tool', () => {
  it('voids a task and shows the correction', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-daily-'));
    try {
      const path = join(dir, 'accounts.db');
      const db = openDatabase(path);
      new Daily(db, { now: () => Date.parse('2026-05-31T12:00:00Z'), random: () => 0, tasks: BANK, judge: async () => ({ verdict: 'passed' }) }).view();
      db.close();
      const out: string[] = [];
      expect(admin([path, 'void', '2026-05-31', '3', 'wrong', 'goal'], (l) => out.push(l))).toBe(0);
      expect(admin([path, 'show', '2026-05-31'], (l) => out.push(l))).toBe(0);
      expect(out[0]).toBe('2026-05-31: task 3 voided, entries rebuilt');
      expect(out.some((l) => l.startsWith('3. level 3') && l.endsWith('VOIDED'))).toBe(true);
      expect(out.at(-1)).toMatch(/ void 3: wrong goal$/);
      expect(admin([path, 'void', '2026-02-30', '1', 'x'], () => {})).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
