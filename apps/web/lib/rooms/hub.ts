/**
 * Live updates of rooms in this process: pages subscribe to a room (app/api/rooms/[code]/events)
 * and are sent the room again when it changes, by a player's action or by the clock (a round
 * starting or ending). The rooms themselves live in the database; this only says when to look again.
 *
 * After a change the room is read once and each watching page gets its own view of it. Changes
 * made in the same turn of the event loop go out together, after the request that made them has
 * its answer: a solve answers the solver first, then tells the room.
 */
import type { Player, RoomView, Rooms } from '@vimchallenge/rooms';

/** A page watching a room: whose it is, and how to send it the room. */
export interface Watcher {
  player?: Player;
  send(view: RoomView | undefined): void;
}

interface Hub {
  watchers: Map<string, Set<Watcher>>;
  timers: Map<string, NodeJS.Timeout>;
  /** Rooms with a change not sent yet. */
  pending: Set<string>;
}

const store = globalThis as typeof globalThis & { __vcRoomWatchers?: Hub };
const hub = (store.__vcRoomWatchers ??= { watchers: new Map(), timers: new Map(), pending: new Set() });

export function subscribe(rooms: Rooms, code: string, watcher: Watcher): () => void {
  let set = hub.watchers.get(code);
  if (!set) hub.watchers.set(code, (set = new Set()));
  set.add(watcher);
  schedule(rooms, code);
  return () => {
    set.delete(watcher);
    if (!set.size) {
      hub.watchers.delete(code);
      clearTimeout(hub.timers.get(code));
      hub.timers.delete(code);
    }
  };
}

/** The room changed: send it to every page watching it, once for all changes of this moment. */
export function changed(rooms: Rooms, code: string): void {
  if (hub.pending.has(code)) return;
  hub.pending.add(code);
  setImmediate(() => {
    hub.pending.delete(code);
    publish(rooms, code);
  });
}

function publish(rooms: Rooms, code: string) {
  const watchers = [...(hub.watchers.get(code) ?? [])];
  if (watchers.length) {
    const views = rooms.views(code, watchers.map((w) => w.player));
    for (const [i, w] of watchers.entries()) w.send(views[i]);
  }
  schedule(rooms, code);
}

/** Sets the timer for the room's next step on its own, if anyone watches it. */
function schedule(rooms: Rooms, code: string) {
  clearTimeout(hub.timers.get(code));
  hub.timers.delete(code);
  if (!hub.watchers.has(code)) return;
  const at = rooms.nextEvent(code);
  if (at === undefined) return;
  const timer = setTimeout(() => changed(rooms, code), Math.min(Math.max(0, at - Date.now()), 2 ** 31 - 1));
  timer.unref?.();
  hub.timers.set(code, timer);
}
