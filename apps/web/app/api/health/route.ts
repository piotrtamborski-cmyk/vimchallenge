/**
 * GET /api/health: for uptime checks and after a release. `release` is the commit the build was
 * made from; `judge` says whether the judge service answers (the pages work without it);
 * `accounts` whether the accounts database opens and answers.
 */
import { authContext } from '../../../lib/auth/context.ts';

export const dynamic = 'force-dynamic';

function accounts(): 'ok' | 'error' {
  try {
    authContext().accounts.db.prepare('SELECT 1').get();
    return 'ok';
  } catch (err) {
    console.error(`accounts database: ${(err as Error).message}`);
    return 'error';
  }
}

export async function GET(): Promise<Response> {
  const judgeUrl = process.env.JUDGE_URL ?? 'http://127.0.0.1:3101';
  let judge = 'down';
  try {
    const res = await fetch(`${judgeUrl}/healthz`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) judge = 'up';
  } catch {
    // Reported as down.
  }
  const db = accounts();
  return Response.json(
    { ok: db === 'ok', release: process.env.VC_RELEASE ?? 'unknown', judge, accounts: db },
    { status: db === 'ok' ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
