/**
 * GET /api/health: for uptime checks and after a release. `release` is the commit the build was
 * made from; `judge` says whether the judge service answers (the pages work without it).
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const judgeUrl = process.env.JUDGE_URL ?? 'http://127.0.0.1:3101';
  let judge = 'down';
  try {
    const res = await fetch(`${judgeUrl}/healthz`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) judge = 'up';
  } catch {
    // Reported as down.
  }
  return Response.json({ ok: true, release: process.env.VC_RELEASE ?? 'unknown', judge }, { headers: { 'cache-control': 'no-store' } });
}
