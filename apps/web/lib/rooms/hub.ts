/**
 * Live updates of rooms in this process: pages subscribe to a room (app/api/rooms/[code]/events)
 * and are told when it changes, by a player's action or by the clock (a round starting or ending).
 * The rooms themselves live in the database; this only says when to look again.
 */
import type { Rooms } from '@vimchallenge/rooms';

type Listener = () => void;

interface Hub {
  listeners: Map<string, Set<Listener>>;
  timers: Map<string, NodeJS.Timeout>;
}

const store = globalThis as typeof globalThis & { __vcRoomsHub?: Hub };
const hub = (store.__vcRoomsHub ??= { listeners: new Map(), timers: new Map() });

export function subscribe(rooms: Rooms, code: string, listener: Listener): () => void {
  let set = hub.listeners.get(code);
  if (!set) hub.listeners.set(code, (set = new Set()));
  set.add(listener);
  schedule(rooms, code);
  return () => {
    set.delete(listener);
    if (!set.size) {
      hub.listeners.delete(code);
      clearTimeout(hub.timers.get(code));
      hub.timers.delete(code);
    }
  };
}

/** Tells every page watching the room to look again, and sets the timer for its next step. */
export function changed(rooms: Rooms, code: string): void {
  for (const listener of [...(hub.listeners.get(code) ?? [])]) listener();
  schedule(rooms, code);
}

function schedule(rooms: Rooms, code: string) {
  clearTimeout(hub.timers.get(code));
  hub.timers.delete(code);
  if (!hub.listeners.has(code)) return;
  const at = rooms.nextEvent(code);
  if (at === undefined) return;
  const timer = setTimeout(() => changed(rooms, code), Math.min(Math.max(0, at - Date.now()), 2 ** 31 - 1));
  timer.unref?.();
  hub.timers.set(code, timer);
}
