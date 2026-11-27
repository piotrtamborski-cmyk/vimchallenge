/**
 * The daily challenge endpoints behind app/api/daily, for the signed-in player: the state as JSON,
 * and the player's actions as JSON from the daily page. As for rooms, every POST must come from
 * this site and be `application/json`, which other sites cannot send without a CORS preflight.
 */
import type { Daily } from '@vimchallenge/daily';
import { requestUser, type AuthContext } from '../auth/context.ts';
import { readBody } from '../body.ts';
import { forbidden, sameOrigin } from '../origin.ts';
import { RateLimiter } from '../rate-limit.ts';

export interface DailyRouteContext {
  auth: AuthContext;
  daily: Daily;
}

/** Key packets per player: about four a second while typing, with room for catching up. */
const packets = new RateLimiter({ burst: 40, perMinute: 600, maxClients: 50_000 });
/** Other actions per player (start, next, check, skip). */
const actions = new RateLimiter({ burst: 20, perMinute: 60, maxClients: 50_000 });

const MAX_JSON_BYTES = 128 * 1024;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

/** GET /api/daily: today's set, and the signed-in player's run. */
export function dailyState(request: Request, ctx: DailyRouteContext): Response {
  const { user } = requestUser(request.headers, ctx.auth);
  return json(200, ctx.daily.view(user?.id));
}

/** POST /api/daily/{action} with JSON: start, next, keys, check, skip. */
export async function dailyAction(request: Request, ctx: DailyRouteContext, action: string): Promise<Response> {
  if (!sameOrigin(request, ctx.auth.config.publicUrl)) return forbidden();
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return json(415, { error: 'send application/json' });
  const { user } = requestUser(request.headers, ctx.auth);
  if (!user) return json(401, { error: 'sign-in' });
  const text = await readBody(request, MAX_JSON_BYTES);
  if (text === undefined) return json(413, { error: 'too-large' });
  let body: Record<string, unknown>;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return json(400, { error: 'bad-json' });
  }
  if (typeof body !== 'object' || body === null) return json(400, { error: 'bad-json' });

  const rate = (action === 'keys' ? packets : actions).take(user.id);
  if (!rate.allowed) return json(429, { error: 'too-many-requests', retryAfter: rate.retryAfterSeconds }, { 'retry-after': String(rate.retryAfterSeconds) });
  const { daily } = ctx;
  const day = String(body.day ?? '');
  const position = Number(body.position);

  switch (action) {
    case 'start': {
      const result = daily.start(user.id, body.boards === true);
      return json(result.ok ? 200 : 409, { ...result, view: daily.view(user.id) });
    }
    case 'next': {
      const result = daily.next(user.id, day);
      return json(result === 'ok' ? 200 : 409, { result, view: daily.view(user.id) });
    }
    case 'keys': {
      const result = daily.appendKeys(user.id, day, position, Number(body.from), body.keys);
      return json(result.ok ? 200 : 409, result);
    }
    case 'check':
      return json(200, await daily.check(user.id, day, position, Number(body.count)));
    case 'skip':
      return json(200, { result: daily.skip(user.id, day, position) });
    default:
      return json(404, { error: 'unknown action' });
  }
}
