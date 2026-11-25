/** Runs one case in the headless browser engine and returns the state after every key. */
import { createHeadlessSession } from '@vimchallenge/engine/headless';
import type { InitialState, Step } from '@vimchallenge/engine';

export interface CmRun {
  /** The initial state, then one step per key. */
  trail: Step[];
  /** Set when the engine threw; `trail` then ends at the last good state. */
  error?: { step: number; message: string };
  ms: number;
}

export async function runCm(initial: InitialState, tokens: string[]): Promise<CmRun> {
  const t0 = performance.now();
  const session = await createHeadlessSession(initial);
  try {
    for (const [i, token] of tokens.entries()) {
      try {
        session.feed(token);
      } catch (e) {
        const trail = session.trail().slice(0, i + 1);
        return { trail, error: { step: i + 1, message: (e as Error).message }, ms: performance.now() - t0 };
      }
    }
    return { trail: [...session.trail()], ms: performance.now() - t0 };
  } finally {
    session.destroy();
  }
}
