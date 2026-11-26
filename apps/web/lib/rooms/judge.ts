/** The judge service as the rooms see it: a verdict, or `JudgeUnavailable` when it cannot answer. */
import { JudgeUnavailable, type Judge, type JudgeVerdict } from '@vimchallenge/rooms';

export function httpJudge(url = () => process.env.JUDGE_URL ?? 'http://127.0.0.1:3101'): Judge {
  return async (job) => {
    let res: Response;
    try {
      res = await fetch(`${url()}/v1/judge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(job),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new JudgeUnavailable('the judge is not reachable');
    }
    if (res.status === 503) throw new JudgeUnavailable('the judge is busy');
    const body = (await res.json().catch(() => ({}))) as { verdict?: string; failures?: []; reason?: string; judge?: { version?: number } };
    if (res.status === 409) return { verdict: 'rejected', reason: 'changed' };
    if (res.status !== 200) return { verdict: 'rejected', reason: `http-${res.status}` };
    if (body.verdict === 'passed') return { verdict: 'passed', judgeVersion: body.judge?.version };
    if (body.verdict === 'failed') return { verdict: 'failed', failures: body.failures ?? [] };
    return { verdict: 'rejected', reason: body.reason ?? 'error' } satisfies JudgeVerdict;
  };
}
