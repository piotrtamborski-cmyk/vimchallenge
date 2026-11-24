/** Runs one case in the headless browser engine and returns the state after every key. */
import { createHeadlessSession } from '@vimchallenge/engine/headless';
import type { InitialState, Snapshot } from '@vimchallenge/engine';

export interface CmRun {
  snapshots: Snapshot[];
  /** Set when the engine threw; `snapshots` then ends at the last good state. */
  error?: { step: number; message: string };
  ms: number;
}

export async function runCm(initial: InitialState, tokens: string[]): Promise<CmRun> {
  const t0 = performance.now();
  const session = await createHeadlessSession(initial);
  const snapshots = [session.snapshot()];
  try {
    for (const [i, token] of tokens.entries()) {
      try {
        session.feed(token);
      } catch (e) {
        return { snapshots, error: { step: i + 1, message: (e as Error).message }, ms: performance.now() - t0 };
      }
      snapshots.push(session.snapshot());
    }
    return { snapshots, ms: performance.now() - t0 };
  } finally {
    session.destroy();
  }
}
