import { describe, expect, it } from 'vitest';
import { availableMs, score, standings } from '../src/index.ts';

const total = (base: number, refS: number, s: number) => {
  const p = score(base, refS * 1000, s * 1000);
  return p.base + p.bonus;
};

describe('points', () => {
  it('follow the examples of the plan', () => {
    // V001: level 1, reference 12 s.
    expect([6, 18, 24].map((s) => total(100, 12, s))).toEqual([125, 112, 100]);
    // V033: level 3, reference 40 s, 160 s available.
    expect([40, 60, 80].map((s) => total(240, 40, s))).toEqual([300, 270, 240]);
    expect(availableMs(40_000)).toBe(160_000);
    expect(total(240, 40, 160)).toBe(240);
  });

  it('give the full bonus up to the reference time and at least a minute to solve', () => {
    expect(score(160, 20_000, 0)).toEqual({ base: 160, bonus: 40 });
    expect(score(160, 20_000, 20_000)).toEqual({ base: 160, bonus: 40 });
    expect(score(160, 20_000, 20_001)).toEqual({ base: 160, bonus: 39 });
    expect(availableMs(10_000)).toBe(60_000);
  });
});

describe('standings', () => {
  const t = (name: string, points: number, solves: number, seconds: number) => ({ player: name, name, points, solves, seconds });

  it('order by points, then solves, then time, and share places', () => {
    const table = standings([t('c', 300, 2, 50), t('a', 400, 2, 90), t('b', 300, 2, 50), t('d', 300, 3, 99), t('e', 0, 0, 0)]);
    expect(table.map((s) => `${s.rank}${s.name}`)).toEqual(['1a', '2d', '3b', '3c', '5e']);
  });

  it('let two winners share the first place', () => {
    expect(standings([t('x', 250, 1, 10), t('y', 250, 1, 10)]).map((s) => s.rank)).toEqual([1, 1]);
  });
});
