/**
 * The room endpoints behind app/api/rooms. Creating and joining are HTML forms (they work without
 * JavaScript and answer with a redirect); playing is JSON from the room page. Every POST must come
 * from this site; JSON also needs `application/json`, which other sites cannot send without a CORS
 * preflight this app never answers.
 */
import type { Player, Rooms, RoomSettings } from '@vimchallenge/rooms';
import type { AuthContext } from '../auth/context.ts';
import { readBody } from '../body.ts';
import { forbidden, sameOrigin } from '../origin.ts';
import { clientKey, RateLimiter } from '../rate-limit.ts';
import { playerOf, playerOrGuest } from './player.ts';

export interface RoomsRouteContext {
  auth: AuthContext;
  rooms: Rooms;
  /** Something in the room changed: tell the pages watching it. */
  notify: (code: string) => void;
}

/** New rooms per client address: 5 at once, then 20 an hour. */
const creating = new RateLimiter({ burst: 5, perMinute: 20 / 60, maxClients: 50_000 });
/** Joins per client address. */
const joining = new RateLimiter({ burst: 20, perMinute: 30, maxClients: 50_000 });
/** Key packets per player: about four a second while typing, with room for catching up. */
const packets = new RateLimiter({ burst: 40, perMinute: 600, maxClients: 50_000 });
/** Other actions per player (checks, ready, skip). */
const actions = new RateLimiter({ burst: 20, perMinute: 60, maxClients: 50_000 });

const MAX_FORM_BYTES = 4_096;
const MAX_JSON_BYTES = 128 * 1024;

const client = (request: Request) => clientKey(request.headers, process.env.CLIENT_IP_HEADER || undefined);

function seeOther(ctx: RoomsRouteContext, path: string, cookie?: string): Response {
  const headers = new Headers({ location: new URL(path, ctx.auth.config.publicUrl).toString(), 'cache-control': 'no-store' });
  if (cookie) headers.append('set-cookie', cookie);
  return new Response(null, { status: 303, headers });
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

const tooMany = (seconds: number) => json(429, { error: 'too-many-requests', retryAfter: seconds }, { 'retry-after': String(seconds) });

async function formOf(request: Request): Promise<URLSearchParams | undefined> {
  if (!/^application\/x-www-form-urlencoded\b/i.test(request.headers.get('content-type') ?? '')) return undefined;
  const body = await readBody(request, MAX_FORM_BYTES);
  return body === undefined ? undefined : new URLSearchParams(body);
}

/** POST /api/rooms (form: name, rounds, level): a new room, and off to it. */
export async function createRoom(request: Request, ctx: RoomsRouteContext): Promise<Response> {
  if (!sameOrigin(request, ctx.auth.config.publicUrl)) return forbidden();
  const form = await formOf(request);
  if (!form) return new Response('Send the form.', { status: 400 });
  const rate = creating.take(client(request));
  if (!rate.allowed) return seeOther(ctx, '/rooms?error=rate');
  const { player, cookie } = playerOrGuest(request.headers, ctx.auth);
  const settings = { rounds: Number(form.get('rounds')), level: form.get('level') ?? '' } as RoomSettings;
  const result = ctx.rooms.create(player, (form.get('name') ?? '').trim(), settings);
  if (!result.ok) return seeOther(ctx, `/rooms?error=${result.error}`, cookie);
  return seeOther(ctx, `/rooms/${result.code}`, cookie);
}

/** POST /api/rooms/{code}/join (form: name). */
export async function joinRoom(request: Request, ctx: RoomsRouteContext, code: string): Promise<Response> {
  if (!sameOrigin(request, ctx.auth.config.publicUrl)) return forbidden();
  const form = await formOf(request);
  if (!form) return new Response('Send the form.', { status: 400 });
  const rate = joining.take(client(request));
  if (!rate.allowed) return seeOther(ctx, `/rooms/${encodeURIComponent(code)}?error=rate`);
  const { player, cookie } = playerOrGuest(request.headers, ctx.auth);
  const result = ctx.rooms.join(code, player, (form.get('name') ?? '').trim());
  if (result === 'not-found') return seeOther(ctx, '/rooms?error=not-found', cookie);
  if (result !== 'ok') return seeOther(ctx, `/rooms/${code}?error=${result}`, cookie);
  ctx.notify(code);
  return seeOther(ctx, `/rooms/${code}`, cookie);
}

/** GET /api/rooms/{code}: the room as this player sees it. */
export function roomState(request: Request, ctx: RoomsRouteContext, code: string): Response {
  const { player } = playerOf(request.headers, ctx.auth);
  const view = ctx.rooms.view(code, player);
  return view ? json(200, view) : json(404, { error: 'not-found' });
}

/** POST /api/rooms/{code}/{action} with JSON: ready, start, leave, keys, check, skip. */
export async function roomAction(request: Request, ctx: RoomsRouteContext, code: string, action: string): Promise<Response> {
  if (action === 'join') return joinRoom(request, ctx, code);
  if (!sameOrigin(request, ctx.auth.config.publicUrl)) return forbidden();
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return json(415, { error: 'send application/json' });
  const { player } = playerOf(request.headers, ctx.auth);
  if (!player) return json(401, { error: 'not-a-player' });
  const text = await readBody(request, MAX_JSON_BYTES);
  if (text === undefined) return json(413, { error: 'too-large' });
  let body: Record<string, unknown>;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return json(400, { error: 'bad-json' });
  }
  if (typeof body !== 'object' || body === null) return json(400, { error: 'bad-json' });

  const rate = (action === 'keys' ? packets : actions).take(player.id);
  if (!rate.allowed) return tooMany(rate.retryAfterSeconds);
  const round = Number(body.round);

  switch (action) {
    case 'ready': {
      const ok = ctx.rooms.setReady(code, player, body.ready === true);
      if (ok) ctx.notify(code);
      return json(ok ? 200 : 404, { ok });
    }
    case 'start': {
      const result = ctx.rooms.start(code, player);
      if (result === 'ok') ctx.notify(code);
      return json(result === 'ok' ? 200 : 409, { result });
    }
    case 'leave': {
      ctx.rooms.leave(code, player);
      ctx.notify(code);
      return json(200, { ok: true });
    }
    case 'keys': {
      const result = ctx.rooms.appendKeys(code, player, round, Number(body.from), body.keys);
      return json(result.ok ? 200 : 409, result);
    }
    case 'check': {
      const result = await ctx.rooms.check(code, player, round, Number(body.count));
      if (result.result === 'solved') ctx.notify(code);
      return json(200, result);
    }
    case 'skip': {
      const result = ctx.rooms.skip(code, player, round);
      ctx.notify(code);
      return json(200, { result });
    }
    default:
      return json(404, { error: 'unknown action' });
  }
}

/**
 * GET /api/rooms/{code}/events: Server-Sent Events with the room as this player sees it, sent
 * whenever it changes and every 20 seconds (which also marks the player present and keeps the
 * connection open through proxies).
 */
export function roomEvents(
  request: Request,
  ctx: RoomsRouteContext,
  code: string,
  subscribe: (code: string, listener: () => void) => () => void,
): Response {
  const { player } = playerOf(request.headers, ctx.auth);
  if (!ctx.rooms.view(code, player)) return json(404, { error: 'not-found' });
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = () => {
        if (!open) return;
        try {
          if (player) ctx.rooms.touch(code, player);
          const view = ctx.rooms.view(code, player);
          controller.enqueue(encoder.encode(view ? `data: ${JSON.stringify(view)}\n\n` : 'event: gone\ndata: {}\n\n'));
        } catch {
          stop();
        }
      };
      const unsubscribe = subscribe(code, send);
      const heartbeat = setInterval(send, 20_000);
      stop = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      request.signal.addEventListener('abort', stop);
      send();
      // Others see this player present again.
      ctx.notify(code);
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      // no-transform keeps compression (which buffers) off the stream.
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
