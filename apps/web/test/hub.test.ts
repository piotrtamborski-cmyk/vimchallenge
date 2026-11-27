/** The room hub: one read of the room per moment of change, sent to every page after the request. */
import type { Player, RoomView, Rooms } from '@vimchallenge/rooms';
import { describe, expect, it } from 'vitest';
import { changed, subscribe } from '../lib/rooms/hub.ts';

const tick = () => new Promise<void>((r) => setImmediate(r));

function fakeRooms() {
  const reads: (string | undefined)[][] = [];
  const rooms = {
    views: (code: string, viewers: readonly (Player | undefined)[]) => {
      reads.push(viewers.map((v) => v?.id));
      return viewers.map((v) => ({ code, now: reads.length, you: v && { name: v.id } }) as unknown as RoomView);
    },
    nextEvent: () => undefined,
  } as unknown as Rooms;
  return { rooms, reads };
}

describe('room hub', () => {
  it('reads the room once for all its pages and sends each its own view', async () => {
    const { rooms, reads } = fakeRooms();
    const got: [string, unknown][] = [];
    const a = subscribe(rooms, 'room-one-1', { player: { id: 'g:a' }, send: (v) => got.push(['a', v?.you]) });
    const b = subscribe(rooms, 'room-one-1', { send: (v) => got.push(['guest', v?.you]) });
    changed(rooms, 'room-one-1');
    changed(rooms, 'room-one-1');
    // Nothing goes out within the request that made the change.
    expect(got).toEqual([]);
    await tick();
    expect(reads).toEqual([['g:a', undefined]]);
    expect(got).toEqual([
      ['a', { name: 'g:a' }],
      ['guest', undefined],
    ]);
    a();
    b();
    changed(rooms, 'room-one-1');
    await tick();
    expect(reads).toHaveLength(1);
  });

  it('keeps rooms apart', async () => {
    const { rooms, reads } = fakeRooms();
    const off = [subscribe(rooms, 'room-two-22', { send: () => {} }), subscribe(rooms, 'room-three', { send: () => {} })];
    changed(rooms, 'room-two-22');
    await tick();
    expect(reads).toHaveLength(1);
    for (const f of off) f();
  });
});
