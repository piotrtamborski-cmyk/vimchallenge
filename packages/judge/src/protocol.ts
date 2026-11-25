/** Messages between the pool (main thread) and a judge worker. */
import type { Expected, GoalFailure, InitialState } from '@vimchallenge/engine';

/** What the judge replays: a task's start and goals, and the key log of one run. */
export interface JudgeJob {
  initial: InitialState;
  expected: Expected;
  keys: readonly string[];
}

/**
 * Why a run was not judged: it broke a limit (see limits.ts), or the worker died on it. The
 * engine is deterministic, so the same run would end the same way again.
 */
export type RejectReason = 'too-many-keys' | 'text-size' | 'time' | 'memory' | 'error';

export type Verdict =
  | { verdict: 'passed' | 'failed'; failures: GoalFailure[] }
  | { verdict: 'rejected'; reason: RejectReason };

export interface ToWorker {
  id: number;
  job: JudgeJob;
  maxTextLength: number;
}

export type FromWorker = { type: 'ready' } | { type: 'result'; id: number; result: Verdict; ms: number };
