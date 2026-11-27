/** The context the room routes run with in this process. */
import { authContext } from '../auth/context.ts';
import { roomsContext } from './context.ts';
import { changed, subscribe, type Watcher } from './hub.ts';
import type { RoomsRouteContext } from './routes.ts';

export function roomsRouteContext(): RoomsRouteContext {
  const rooms = roomsContext();
  return { auth: authContext(), rooms, notify: (code) => changed(rooms, code) };
}

export const subscribeRoom = (code: string, watcher: Watcher) => subscribe(roomsContext(), code, watcher);
