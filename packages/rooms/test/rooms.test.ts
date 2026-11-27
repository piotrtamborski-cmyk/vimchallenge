import { Accounts, openDatabase } from '@vimchallenge/accounts';
import { describe, expect, it } from 'vitest';
import {
  AWAY_MS,
  BREAK_MS,
  COUNTDOWN_MS,
  GRACE_MS,
  HOST_AWAY_MS,
  JudgeUnavailable,
  MAX_MEMBERS,
  Rooms,
  type JudgeJob,
  type JudgeVerdict,
  type Player,
} from '../src/index.ts';

const A: Player = { id: 'g:alice' };
const B: Player = { id: 'g:bob' };
const C: Player = { id: 'g:carol' };

/**
 * A room with a fake clock and a fake judge: a run passes when its last key is `Z`. The judge can be
 * made unavailable, and records what it was asked.
 */
function setup(options: { rounds?: number; level?: '1' | 'mixed' } = {}) {
  let now = 1_900_000_000_000;
  const db = openDatabase(':memory:');
  const jobs: JudgeJob[] = [];
  const judge = { down: false };
  const solved: string[] = [];
  const make = () =>
    new Rooms(db, {
      now: () => now,
      random: () => 0,
      judge: async (job): Promise<JudgeVerdict> => {
        jobs.push(job);
        if (judge.down) throw new JudgeUnavailable('down');
        return job.keys.at(-1) === 'Z' ? { verdict: 'passed' } : { verdict: 'failed', failures: [{ field: 'text', want: ['x'], got: ['y'] }] };
      },
      onSolved: (userId, s) => solved.push(`${userId}:${s.taskId}`),
    });
  const rooms = make();
  const created = rooms.create(A, 'alice', { rounds: options.rounds ?? 2, level: options.level ?? 'mixed' });
  if (!created.ok) throw new Error(created.error);
  const code = created.code;
  return {
    rooms,
    code,
    jobs,
    judge,
    solved,
    make,
    clock: { now: () => now, set: (t: number) => (now = t), advance: (ms: number) => (now += ms) },
    view: (p?: Player) => rooms.view(code, p)!,
    db,
  };
}

/** Two players in the room, both ready, and the match started. */
function started(options: Parameters<typeof setup>[0] = {}) {
  const s = setup(options);
  expect(s.rooms.join(s.code, B, 'bob')).toBe('ok');
  s.rooms.setReady(s.code, A, true);
  s.rooms.setReady(s.code, B, true);
  expect(s.rooms.start(s.code, A)).toBe('ok');
  return s;
}

describe('the lobby', () => {
  it('takes up to eight members with names unique in the room', () => {
    const s = setup();
    expect(s.view(A).phase).toBe('lobby');
    expect(s.rooms.join(s.code, B, 'ALICE')).toBe('name-taken');
    expect(s.rooms.join(s.code, B, 'b')).toBe('name-invalid');
    expect(s.rooms.join(s.code, B, 'bob')).toBe('ok');
    expect(s.rooms.join(s.code, B, 'bobby')).toBe('ok');
    for (let i = 3; i <= MAX_MEMBERS; i++) expect(s.rooms.join(s.code, { id: `g:${i}` }, `player${i}`)).toBe('ok');
    expect(s.rooms.join(s.code, { id: 'g:late' }, 'late')).toBe('full');
    expect(s.view(B).members.filter((m) => m.you).map((m) => m.name)).toEqual(['bobby']);
    expect(s.rooms.join('nosuchroom', B, 'bob')).toBe('not-found');
  });

  it('starts with the host and at least two ready players present', () => {
    const s = setup();
    s.rooms.join(s.code, B, 'bob');
    s.rooms.join(s.code, C, 'carol');
    expect(s.rooms.start(s.code, B)).toBe('not-host');
    expect(s.rooms.start(s.code, A)).toBe('too-few');
    s.rooms.setReady(s.code, A, true);
    expect(s.view(A).start).toEqual({ allowed: false, reason: 'too-few' });
    s.rooms.setReady(s.code, B, true);
    expect(s.view(A).start).toEqual({ allowed: true });
    expect(s.view(B).start).toEqual({ allowed: false, reason: 'not-host' });
    expect(s.rooms.start(s.code, A)).toBe('ok');
    expect(s.rooms.start(s.code, A)).toBe('running');
    // Carol was not ready: she watches this match and may play the next.
    const carol = s.view(C);
    expect(carol.you).toMatchObject({ playing: false });
    expect(carol.match!.standings.map((p) => p.name).sort()).toEqual(['alice', 'bob']);
    expect(s.view(A).members.every((m) => !m.ready)).toBe(true);
  });

  it('lets the first present member start when the host is away', () => {
    const s = setup();
    s.rooms.join(s.code, B, 'bob');
    s.rooms.join(s.code, C, 'carol');
    s.clock.advance(HOST_AWAY_MS);
    s.rooms.setReady(s.code, B, true);
    s.rooms.setReady(s.code, C, true);
    expect(s.rooms.start(s.code, C)).toBe('not-host');
    expect(s.rooms.start(s.code, B)).toBe('ok');
    expect(s.view(B).members.find((m) => m.you)!.host).toBe(true);
    expect(s.view(B).members.find((m) => m.name === 'alice')!.away).toBe(true);
  });

  it('passes the host on when the host leaves', () => {
    const s = setup();
    s.rooms.join(s.code, B, 'bob');
    s.rooms.leave(s.code, A);
    expect(s.view(B).members).toEqual([{ name: 'bob', ready: false, host: true, away: false, you: true }]);
  });
});

describe('a round', () => {
  it('gives every player the same task only when it starts', () => {
    const s = started();
    const before = s.view(A);
    expect(before.phase).toBe('countdown');
    expect(before.match!.round).toMatchObject({ number: 1, level: 1, base: 100 });
    expect(before.match!.round!.task).toBeUndefined();
    expect(s.rooms.appendKeys(s.code, A, 1, 0, ['x'])).toEqual({ ok: false, error: 'not-started' });

    s.clock.advance(COUNTDOWN_MS);
    const a = s.view(A).match!.round!;
    const b = s.view(B).match!.round!;
    expect(s.view(A).phase).toBe('round');
    expect(a.task).toBeDefined();
    expect(b.task).toEqual(a.task);
    expect(a.deadline - a.startsAt).toBe(a.availableMs);
    expect(s.view(C)?.match?.round?.task).toBeUndefined();
  });

  it('takes keys in packets, ignoring repeats and asking for gaps', () => {
    const s = started();
    s.clock.advance(COUNTDOWN_MS);
    expect(s.rooms.appendKeys(s.code, A, 1, 0, ['d', 'w'])).toEqual({ ok: true, have: 2 });
    expect(s.rooms.appendKeys(s.code, A, 1, 0, ['d', 'w'])).toEqual({ ok: true, have: 2 });
    expect(s.rooms.appendKeys(s.code, A, 1, 5, ['x'])).toEqual({ ok: true, have: 2 });
    expect(s.rooms.appendKeys(s.code, A, 1, 2, ['<Esc>'])).toEqual({ ok: true, have: 3 });
    expect(s.rooms.appendKeys(s.code, A, 1, 3, ['<Nope>'])).toEqual({ ok: false, error: 'bad-keys' });
    expect(s.rooms.appendKeys(s.code, A, 1, 3, 'x')).toEqual({ ok: false, error: 'bad-keys' });
    expect(s.rooms.appendKeys(s.code, C, 1, 0, ['x'])).toEqual({ ok: false, error: 'not-playing' });
    // A reload finds the keys typed so far, and the same deadline.
    const round = s.view(A).match!.round!;
    expect(round.mine).toMatchObject({ status: 'open', keys: ['d', 'w', '<Esc>'] });
    expect(s.view(B).match!.round!.mine!.keys).toEqual([]);
  });

  it('scores a solve once, by the time the server received the check', async () => {
    const s = started();
    s.clock.advance(COUNTDOWN_MS);
    const round = s.view(A).match!.round!;
    s.rooms.appendKeys(s.code, A, 1, 0, ['x']);
    expect(await s.rooms.check(s.code, A, 1, 2)).toEqual({ result: 'error', error: 'missing-keys', have: 1 });
    expect(await s.rooms.check(s.code, A, 1, 1)).toMatchObject({ result: 'failed' });

    s.clock.advance(4_000);
    s.rooms.appendKeys(s.code, A, 1, 1, ['Z']);
    const solve = await s.rooms.check(s.code, A, 1, 2);
    const expected = { base: 100, bonus: 25 };
    expect(solve).toEqual({ result: 'solved', ms: 4_000, ...expected });
    // Asking again, or from a second tab, returns the same and scores nothing more.
    s.clock.advance(1_000);
    expect(await s.rooms.check(s.code, A, 1, 2)).toEqual(solve);
    expect(s.rooms.appendKeys(s.code, A, 1, 2, ['x'])).toEqual({ ok: false, error: 'closed' });
    expect(s.jobs).toHaveLength(2);
    expect(s.jobs[1]).toEqual({ task: round.task!.id, version: round.task!.version, text: round.task!.text, keys: ['x', 'Z'] });

    // Others see that Alice finished, not her time or points, until the round ends.
    const bob = s.view(B).match!.round!;
    expect(bob.statuses).toEqual([
      { name: 'alice', you: false, away: false, status: 'solved' },
      { name: 'bob', you: true, away: false, status: 'open' },
    ]);
    expect(JSON.stringify(s.view(B))).not.toContain('"ms"');
  });

  it('ends when everyone has finished, and shows the results during the break', async () => {
    const s = started();
    s.clock.advance(COUNTDOWN_MS);
    s.rooms.appendKeys(s.code, A, 1, 0, ['Z']);
    s.clock.advance(2_000);
    await s.rooms.check(s.code, A, 1, 1);
    s.clock.advance(3_000);
    expect(s.rooms.skip(s.code, B, 1)).toBe('skipped');
    const ended = s.clock.now();

    const view = s.view(A);
    expect(view.phase).toBe('break');
    expect(view.match!.past).toHaveLength(1);
    expect(view.match!.past[0]!.results).toEqual([
      { name: 'alice', you: true, status: 'solved', ms: 2_000, base: 100, bonus: 25 },
      { name: 'bob', you: false, status: 'skipped', ms: undefined, base: 0, bonus: 0 },
    ]);
    expect(view.match!.standings.map((p) => [p.rank, p.name, p.points])).toEqual([
      [1, 'alice', 125],
      [2, 'bob', 0],
    ]);
    expect(view.match!.round).toMatchObject({ number: 2, startsAt: ended + BREAK_MS });
    expect(view.match!.round!.task).toBeUndefined();
  });

  it('times out at the deadline; a check exactly at the deadline still counts', async () => {
    const s = started({ rounds: 1, level: '1' });
    s.clock.advance(COUNTDOWN_MS);
    const { deadline } = s.view(A).match!.round!;
    s.rooms.appendKeys(s.code, A, 1, 0, ['Z']);
    s.rooms.appendKeys(s.code, B, 1, 0, ['Z']);
    s.clock.set(deadline);
    expect(await s.rooms.check(s.code, A, 1, 1)).toMatchObject({ result: 'solved', bonus: 0, base: 100 });
    s.clock.set(deadline + 1);
    expect(await s.rooms.check(s.code, B, 1, 1)).toEqual({ result: 'closed', status: 'timeout' });
    const view = s.view(A);
    expect(view.phase).toBe('finished');
    expect(view.match!.standings.map((p) => [p.rank, p.name, p.points, p.solves])).toEqual([
      [1, 'alice', 100, 1],
      [2, 'bob', 0, 0],
    ]);
  });

  it('keeps the time of a check received while the judge was down', async () => {
    const s = started({ rounds: 1, level: '1' });
    s.clock.advance(COUNTDOWN_MS);
    const { deadline, startsAt } = s.view(A).match!.round!;
    s.rooms.appendKeys(s.code, A, 1, 0, ['Z']);
    s.judge.down = true;
    s.clock.set(deadline - 1_000);
    expect(await s.rooms.check(s.code, A, 1, 1)).toEqual({ result: 'error', error: 'judge-unavailable' });
    // After the deadline the round waits a little for that check, not for anyone else.
    s.clock.set(deadline + 5_000);
    expect(s.view(A).phase).toBe('round');
    expect(s.view(B).match!.round!.statuses.find((x) => x.you)!.status).toBe('open');
    s.judge.down = false;
    const solve = await s.rooms.check(s.code, A, 1, 1);
    expect(solve).toMatchObject({ result: 'solved', ms: deadline - 1_000 - startsAt });
    expect(s.view(A).phase).toBe('finished');
  });

  it('gives up on a check the judge never answered, after the grace', async () => {
    const s = started({ rounds: 1, level: '1' });
    s.clock.advance(COUNTDOWN_MS);
    const { deadline } = s.view(A).match!.round!;
    s.rooms.appendKeys(s.code, A, 1, 0, ['Z']);
    s.judge.down = true;
    s.clock.set(deadline);
    await s.rooms.check(s.code, A, 1, 1);
    s.clock.set(deadline + GRACE_MS + 1);
    expect(s.view(A).phase).toBe('finished');
    expect(s.view(A).match!.past[0]!.results.map((r) => r.status)).toEqual(['timeout', 'timeout']);
  });

  it('refuses a check sent after the deadline', async () => {
    const s = started({ rounds: 2, level: '1' });
    s.clock.advance(COUNTDOWN_MS);
    const { deadline } = s.view(A).match!.round!;
    s.rooms.appendKeys(s.code, A, 1, 0, ['Z']);
    s.clock.set(deadline + 1);
    expect(await s.rooms.check(s.code, A, 1, 1)).toEqual({ result: 'closed', status: 'timeout' });
  });
});

describe('a match', () => {
  it('runs every round to a final table, then a new match draws new tasks', async () => {
    const s = started({ rounds: 2, level: 'mixed' });
    const play = async (round: number, who: Player, afterMs: number) => {
      s.rooms.appendKeys(s.code, who, round, 0, ['Z']);
      s.clock.advance(afterMs);
      return s.rooms.check(s.code, who, round, 1);
    };
    s.clock.advance(COUNTDOWN_MS);
    const first = s.view(A).match!.round!.task!.id;
    await play(1, A, 1_000);
    await play(1, B, 1_000);
    s.clock.advance(BREAK_MS);
    expect(s.view(A).match!.round).toMatchObject({ number: 2, level: 3 });
    await play(2, B, 1_000);
    await play(2, A, 1_000);
    const end = s.view(A);
    expect(end.phase).toBe('finished');
    expect(end.match!.standings.map((p) => [p.rank, p.name])).toEqual([
      [1, 'alice'],
      [1, 'bob'],
    ]);
    expect(end.match!.past.map((r) => r.number)).toEqual([1, 2]);

    s.rooms.setReady(s.code, A, true);
    s.rooms.setReady(s.code, B, true);
    expect(s.rooms.start(s.code, A)).toBe('ok');
    s.clock.advance(COUNTDOWN_MS);
    const again = s.view(A);
    expect(again.match!.number).toBe(2);
    expect(again.match!.round!.task!.id).not.toBe(first);
  });

  it('carries on through a restart of the process', async () => {
    const s = started({ rounds: 2, level: '1' });
    s.clock.advance(COUNTDOWN_MS);
    s.rooms.appendKeys(s.code, A, 1, 0, ['d', 'w']);
    const before = s.view(A);
    const restarted = s.make();
    expect(restarted.view(s.code, A)).toEqual(before);
    // A round that ended while the process was down starts its break when the room is next seen.
    const { deadline } = before.match!.round!;
    s.clock.set(deadline + GRACE_MS + 60_000);
    const later = restarted.view(s.code, A)!;
    expect(later.phase).toBe('break');
    expect(later.match!.round!.startsAt).toBe(s.clock.now() + BREAK_MS);
  });

  it('keeps rooms apart', async () => {
    const s = started({ rounds: 1, level: '1' });
    const other = s.rooms.create(C, 'carol', { rounds: 1, level: '1' });
    if (!other.ok) throw new Error('create failed');
    s.rooms.join(other.code, { id: 'g:dave' }, 'dave');
    expect(s.rooms.view(other.code, C)!.phase).toBe('lobby');
    s.clock.advance(COUNTDOWN_MS);
    expect(s.rooms.appendKeys(other.code, A, 1, 0, ['Z'])).toEqual({ ok: false, error: 'not-playing' });
    expect(await s.rooms.check(other.code, A, 1, 0)).toEqual({ result: 'error', error: 'not-playing' });
    expect(s.rooms.view(other.code, A)!.you).toBeUndefined();
  });

  it('saves the solves of signed-in players to their progress, once', async () => {
    const s = setup({ rounds: 1, level: '1' });
    const signedIn = new Accounts(s.db).signIn({ provider: 'github', subject: '1' });
    if (!signedIn.ok) throw new Error('sign-in failed');
    const user: Player = { id: `u:${signedIn.user.id}`, userId: signedIn.user.id };
    s.rooms.join(s.code, user, 'member');
    s.rooms.setReady(s.code, A, true);
    s.rooms.setReady(s.code, user, true);
    s.rooms.start(s.code, A);
    s.clock.advance(COUNTDOWN_MS);
    s.rooms.appendKeys(s.code, user, 1, 0, ['Z']);
    s.rooms.appendKeys(s.code, A, 1, 0, ['Z']);
    await Promise.all([s.rooms.check(s.code, user, 1, 1), s.rooms.check(s.code, user, 1, 1)]);
    await s.rooms.check(s.code, A, 1, 1);
    expect(s.solved).toEqual([`${signedIn.user.id}:${s.view(A).match!.past[0]!.taskId}`]);
  });

  it('shows members who left their page as away', () => {
    const s = started();
    s.clock.advance(AWAY_MS);
    s.rooms.touch(s.code, A);
    expect(s.view(A).members.map((m) => [m.name, m.away])).toEqual([
      ['alice', false],
      ['bob', true],
    ]);
  });
});

describe('views for everyone watching', () => {
  it('equal each viewer’s own view, in the lobby, during a round and after one', async () => {
    const s = started({ rounds: 3 });
    expect(s.rooms.join(s.code, C, 'carol')).toBe('ok');
    const viewers = [A, B, C, undefined, { id: 'g:stranger' }];
    const same = () => expect(s.rooms.views(s.code, viewers)).toEqual(viewers.map((v) => s.rooms.view(s.code, v)));
    same();
    s.clock.advance(COUNTDOWN_MS);
    s.rooms.appendKeys(s.code, A, 1, 0, ['x', 'Z']);
    s.rooms.appendKeys(s.code, B, 1, 0, ['y']);
    same();
    // The viewer's own keys come back to their page, and only to it.
    const [a, b, c] = s.rooms.views(s.code, [A, B, C]);
    expect(a!.match!.round!.mine!.keys).toEqual(['x', 'Z']);
    expect(b!.match!.round!.mine!.keys).toEqual(['y']);
    expect(c!.match!.round!.mine).toBeUndefined();
    s.clock.advance(2_000);
    await s.rooms.check(s.code, A, 1, 2);
    s.rooms.skip(s.code, B, 1);
    same();
    expect(s.view(A).match!.past).toHaveLength(1);
    expect(s.rooms.views('nothing-he', viewers)).toEqual(viewers.map(() => undefined));
  });
});
