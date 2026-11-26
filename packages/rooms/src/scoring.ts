/**
 * Points in a room (plany/03): a solve earns the base of its level, and up to a quarter more when
 * it comes within twice the task's reference time; the full bonus until the reference time itself.
 * All in whole milliseconds; only the bonus is rounded, down.
 */

/** Bumped whenever the rules below change, and stored with each match. */
export const SCORING_VERSION = 1;

/** Time to solve a round: four times the reference time, at least a minute. */
export const availableMs = (referenceMs: number): number => Math.max(60_000, 4 * referenceMs);

/** Base and bonus of a solve `ms` after the round started. */
export function score(base: number, referenceMs: number, ms: number): { base: number; bonus: number } {
  const left = Math.min(referenceMs, Math.max(0, 2 * referenceMs - ms));
  return { base, bonus: Math.floor((base * left) / (4 * referenceMs)) };
}

export interface Tally {
  player: string;
  name: string;
  points: number;
  solves: number;
  /** Sum of the solve times, each in whole seconds rounded down. */
  seconds: number;
}

export type Standing = Tally & { rank: number };

/**
 * Most points first; then more solves; then less time on the solves. Players equal on all three
 * share a place, and the next place is skipped (1, 1, 3).
 */
export function standings(tallies: readonly Tally[]): Standing[] {
  const sorted = [...tallies].sort((a, b) => b.points - a.points || b.solves - a.solves || a.seconds - b.seconds || a.name.localeCompare(b.name));
  return sorted.map((t, i) => {
    let first = i;
    while (first > 0 && same(sorted[first - 1]!, t)) first--;
    return { ...t, rank: first + 1 };
  });
}

const same = (a: Tally, b: Tally) => a.points === b.points && a.solves === b.solves && a.seconds === b.seconds;
