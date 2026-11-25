/** One judged run, in the calling thread. The pool runs it in a worker it can stop. */
import { checkGoals } from '@vimchallenge/engine';
import { replay } from '@vimchallenge/engine/headless';
import type { JudgeJob, Verdict } from './protocol.ts';

const textLength = (lines: readonly string[]) => lines.reduce((n, l) => n + l.length, lines.length - 1);

export async function judgeRun(job: JudgeJob, maxTextLength: number): Promise<Verdict> {
  let tooLarge = false;
  const trail = await replay(job.initial, job.keys, (step) => {
    tooLarge = textLength(step.snapshot.lines) > maxTextLength;
    return !tooLarge;
  });
  if (tooLarge) return { verdict: 'rejected', reason: 'text-size' };
  const failures = checkGoals(trail, job.expected);
  return { verdict: failures.length ? 'failed' : 'passed', failures };
}
