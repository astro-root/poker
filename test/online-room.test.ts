import test from 'node:test';
import assert from 'node:assert/strict';
import { createTable } from '../src/poker/table.ts';
import { canApplyRoomUpdate } from '../src/supabase/room-state.ts';

test('out-of-order room responses cannot replace a newer revision or table version', async () => {
  const base = createTable([{ id: 'a', stack: 100 }, { id: 'b', stack: 100 }], 5, 10);
  const stale = { roomId: 'room-a', revision: 4, table: { ...base, handNumber: 2, version: 8 } };
  const latest = { roomId: 'room-a', revision: 5, table: { ...base, handNumber: 2, version: 9 } };
  let current = { roomId: 'room-a', revision: 3, table: { ...base, handNumber: 2, version: 7 } };

  let resolveStale!: (value: typeof stale) => void;
  let resolveLatest!: (value: typeof latest) => void;
  const staleResponse = new Promise<typeof stale>((resolve) => { resolveStale = resolve; });
  const latestResponse = new Promise<typeof latest>((resolve) => { resolveLatest = resolve; });
  const apply = async (response: Promise<typeof stale | typeof latest>) => {
    const incoming = await response;
    if (canApplyRoomUpdate(current.roomId, incoming.roomId, current.roomId, current.revision, incoming.revision, current.table, incoming.table)) {
      current = incoming;
    }
  };

  const olderRequest = apply(staleResponse);
  const newerRequest = apply(latestResponse);
  resolveLatest(latest);
  await newerRequest;
  resolveStale(stale);
  await olderRequest;
  assert.equal(current.revision, 5);
  assert.equal(current.table.version, 9);
  assert.equal(canApplyRoomUpdate('room-a', 'room-b', 'room-a', 5, 6, current.table, latest.table), false);
  assert.equal(canApplyRoomUpdate('room-a', 'room-a', 'room-a', 5, 5,
    { ...current.table, handNumber: 3, version: 2 }, current.table), false);
});
