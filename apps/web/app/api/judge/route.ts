/**
 * POST /api/judge: forwards a run to the judge service (packages/judge) on the same host, so the
 * browser talks to its own origin only. The judge listens on localhost; JUDGE_URL points at it.
 *
 * Only `application/json` is accepted, which browsers cannot send cross-site without a CORS
 * preflight that this route never answers, so other sites cannot use it.
 */
import { clientKey, RateLimiter } from '../../../lib/rate-limit.ts';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 128 * 1024;
const TIMEOUT_MS = 10_000;

/**
 * Checks per client address: a burst of 20, then 30 a minute (JUDGE_RATE_BURST,
 * JUDGE_RATE_PER_MINUTE). A player checks a solve every few seconds at most; a class behind one
 * address shares the budget, so it is generous. CLIENT_IP_HEADER names the header with the
 * client's address when a proxy sets one (`cf-connecting-ip` behind Cloudflare).
 */
const limiter = new RateLimiter({
  perMinute: Number(process.env.JUDGE_RATE_PER_MINUTE) || 30,
  burst: Number(process.env.JUDGE_RATE_BURST) || 20,
  maxClients: 50_000,
});

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

export async function POST(request: Request): Promise<Response> {
  const rate = limiter.take(clientKey(request.headers, process.env.CLIENT_IP_HEADER || undefined));
  if (!rate.allowed)
    return reply(429, { error: 'too many checks; try again later', retryAfter: rate.retryAfterSeconds }, { 'retry-after': String(rate.retryAfterSeconds) });
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return reply(415, { error: 'send application/json' });
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return reply(413, { error: 'the run is too large' });
  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return reply(413, { error: 'the run is too large' });

  const judgeUrl = process.env.JUDGE_URL ?? 'http://127.0.0.1:3101';
  let res: Response;
  try {
    res = await fetch(`${judgeUrl}/v1/judge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return reply(503, { error: 'the judge is not available' });
  }
  // The judge's answer is passed on as it is: verdicts, and its 4xx/503 for runs it cannot judge.
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) headers.set('retry-after', retryAfter);
  return new Response(await res.text(), { status: res.status, headers });
}
