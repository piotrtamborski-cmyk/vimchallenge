/**
 * POST /api/judge: forwards a run to the judge service (packages/judge) on the same host, so the
 * browser talks to its own origin only. The judge listens on localhost; JUDGE_URL points at it.
 *
 * Only `application/json` is accepted, which browsers cannot send cross-site without a CORS
 * preflight that this route never answers, so other sites cannot use it.
 */
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 128 * 1024;
const TIMEOUT_MS = 10_000;

const reply = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
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
