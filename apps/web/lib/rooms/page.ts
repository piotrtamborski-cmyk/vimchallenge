/** The player of a page request (server components), for the room pages. */
import { headers } from 'next/headers';
import { authContext, authConfig } from '../auth/context.ts';
import { readCookie, sessionCookie } from '../auth/cookies.ts';
import { guestCookie, playerOf, type Identity } from './player.ts';

export async function pagePlayer(): Promise<Identity> {
  const cookie = (await headers()).get('cookie') ?? '';
  const h = new Headers({ cookie });
  const config = authConfig();
  // Without any cookie of ours there is no player, and no need to open the database.
  if (!readCookie(h, sessionCookie(config.secure)) && !readCookie(h, guestCookie(config.secure))) return {};
  return playerOf(h, authContext());
}
