/** The context the room routes run with in this process. */
import { authContext } from '../auth/context.ts';
import { roomsContext } from './context.ts';
import { changed, subscribe } from './hub.ts';
import type { RoomsRouteContext } from './routes.ts';

export function roomsRouteContext(): RoomsRouteContext {
  const rooms = roomsContext();
  return { auth: authContext(), rooms, notify: (code) => changed(rooms, code) };
}

export const subscribeRoom = (code: string, listener: () => void) => subscribe(roomsContext(), code, listener);
