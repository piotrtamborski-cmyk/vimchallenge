/** The rooms of this process, on the accounts database, judged by the judge service. */
import { Rooms } from '@vimchallenge/rooms';
import { authContext } from '../auth/context.ts';
import { httpJudge } from './judge.ts';

const store = globalThis as typeof globalThis & { __vcRooms?: Rooms };

export function roomsContext(): Rooms {
  if (!store.__vcRooms) {
    const { accounts } = authContext();
    store.__vcRooms = new Rooms(accounts.db, {
      judge: httpJudge(),
      onSolved: (userId, s) => accounts.recordSolve(userId, s),
    });
  }
  return store.__vcRooms;
}

/** Replaces the rooms of this process (tests). */
export function setRoomsContext(rooms: Rooms | undefined): void {
  store.__vcRooms = rooms;
}
