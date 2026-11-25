/**
 * Limits of one judged run. They are part of the judge's contract: a run inside them gets the
 * same verdict on every server, so raise JUDGE_VERSION when they change.
 */
export const JUDGE_VERSION = 1;

export interface Limits {
  /** Keys in one run. */
  maxKeys: number;
  /** Length of the buffer (UTF-16 code units, line breaks included) after any key. */
  maxTextLength: number;
  /** Time for one replay, from the moment a worker takes the job. */
  timeMs: number;
  /** V8 heap of one worker (old generation), in MB. */
  heapMb: number;
}

export const LIMITS: Readonly<Limits> = {
  maxKeys: 5000,
  maxTextLength: 20_000,
  timeMs: 2000,
  heapMb: 128,
};
