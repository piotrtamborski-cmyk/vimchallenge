/**
 * Who is playing: a signed-in player by their account, a guest by a random token in a cookie (only
 * its hash is stored). Guests may create and join rooms; the cookie is made when they first do.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Player } from '@vimchallenge/rooms';
import type { AuthContext } from '../auth/context.ts';
import { requestUser } from '../auth/context.ts';
import { readCookie, setCookie } from '../auth/cookies.ts';

export const guestCookie = (secure: boolean) => (secure ? '__Host-vc_guest' : 'vc_guest');
const GUEST_DAYS = 30;

const guestId = (token: string) => `g:${createHash('sha256').update(token).digest('base64url').slice(0, 32)}`;

export interface Identity {
  player?: Player;
  /** A name to offer: the account's. */
  name?: string;
}

/** The player of a request, if it has a session or a guest cookie. */
export function playerOf(headers: Headers, ctx: AuthContext): Identity {
  const { user } = requestUser(headers, ctx);
  if (user) return { player: { id: `u:${user.id}`, userId: user.id }, name: user.name };
  const token = readCookie(headers, guestCookie(ctx.config.secure));
  return token && /^[\w-]{43}$/.test(token) ? { player: { id: guestId(token) } } : {};
}

/** The player of a request, making a guest (and the cookie to send) when there is none. */
export function playerOrGuest(headers: Headers, ctx: AuthContext): { player: Player; cookie?: string } {
  const known = playerOf(headers, ctx).player;
  if (known) return { player: known };
  const token = randomBytes(32).toString('base64url');
  return {
    player: { id: guestId(token) },
    cookie: setCookie(guestCookie(ctx.config.secure), token, GUEST_DAYS * 86_400, ctx.config.secure),
  };
}
