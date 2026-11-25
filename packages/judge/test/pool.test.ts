import { parseKeys } from '@vimchallenge/engine';
import { tasks } from '@vimchallenge/tasks';
import { afterAll, describe, expect, it } from 'vitest';
import { JudgePool, PoolBusyError } from '../src/pool.ts';

const run = (lines: string[], keys: string, expected = {}) => ({
  initial: { lines, cursor: [1, 1] as [number, number] },
  expected,
  keys: parseKeys(keys),
});
/** Inserting 99999 characters one by one takes the engine about a minute. */
const SLOW = run(['a'], '99999ix<Esc>');

describe('judge pool', { timeout: 30_000 }, () => {
  const pools: JudgePool[] = [];
  const pool = (options: ConstructorParameters<typeof JudgePool>[0]) => {
    const p = new JudgePool(options);
    pools.push(p);
    return p;
  };
  afterAll(() => Promise.all(pools.map((p) => p.close())));

  it('judges every published task, two workers at a time', async () => {
    const p = pool({ workers: 2, maxQueue: tasks.length });
    const outcomes = await Promise.all(tasks.map((t) => p.judge({ initial: t.initial, expected: t.expected, keys: parseKeys(t.keys) })));
    expect(outcomes.map((o) => o.verdict)).toEqual(tasks.map(() => 'passed'));
  });

  it('starts every run from a fresh session', async () => {
    const p = pool({ workers: 1 });
    const yank = await p.judge(run(['hello'], '"ayiw', { registers: { a: { type: 'char', text: 'hello' } } }));
    expect(yank.verdict).toBe('passed');
    // Same worker: register a, the undo history and the last search are gone.
    const after = await p.judge(run(['x'], '"apun', { lines: ['x'] }));
    expect(after.verdict).toBe('passed');
  });

  it('stops a run that takes too long and keeps judging', async () => {
    const p = pool({ workers: 1, limits: { timeMs: 300 } });
    const slow = await p.judge(SLOW);
    expect(slow).toMatchObject({ verdict: 'rejected', reason: 'time' });
    expect(slow.judgeMs).toBeLessThan(1000);
    expect((await p.judge(run(['ab'], 'x', { lines: ['b'] }))).verdict).toBe('passed');
  });

  it('rejects a run whose text grows past the limit', async () => {
    const p = pool({ workers: 1, limits: { maxTextLength: 50 } });
    expect(await p.judge(run(['a'], '60ix<Esc>'))).toMatchObject({ verdict: 'rejected', reason: 'text-size' });
  });

  it('rejects a run with too many keys without replaying it', async () => {
    const p = pool({ workers: 1, limits: { maxKeys: 3 } });
    expect(await p.judge(run(['a'], 'xxxx'))).toMatchObject({ verdict: 'rejected', reason: 'too-many-keys', judgeMs: 0 });
  });

  it('refuses work when every worker is busy and the queue is full', async () => {
    const p = pool({ workers: 1, maxQueue: 1, limits: { timeMs: 500 } });
    await p.ready();
    const slow = p.judge(SLOW);
    const queued = p.judge(run(['ab'], 'x', { lines: ['b'] }));
    await expect(p.judge(run(['ab'], 'x'))).rejects.toBeInstanceOf(PoolBusyError);
    expect((await slow).verdict).toBe('rejected');
    const second = await queued;
    expect(second.verdict).toBe('passed');
    expect(second.queueMs).toBeGreaterThan(400);
  });
});
