import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarness, U } from './helpers/room-harness.ts';

const [A, B, C, D, E, F, G] = [1, 2, 3, 4, 5, 6, 7].map(U);

test('server fixes (A-4..A-9, T4-2) against the mocked Edge runtime', async (t) => {
  const h = await createHarness();
  try {
    await t.test('A-5: ten consecutive state polls cause at most one database write', async () => {
      h.rooms.clear();
      const roomId = await h.createRoomWith(A!, [B!]);
      h.clock.now += 6_000;
      h.writes.length = 0;
      for (let i = 0; i < 10; i++) {
        h.clock.now += 100;
        const res = await h.call(A!, { action: 'state', roomId });
        assert.equal(res.status, 200);
      }
      assert.ok(h.writes.length <= 1, `expected <=1 writes, got ${h.writes.length}`);
      // Presence still expires after 15 seconds without polling.
      h.clock.now += 16_000;
      const peers = (await h.json(await h.call(A!, { action: 'state', roomId }))).room.peers as Array<{ id: string; connected: boolean }>;
      assert.equal(peers.find((p) => p.id === B)!.connected, false);
      assert.equal(peers.find((p) => p.id === A)!.connected, true);
    });

    await t.test('A-6: full / started / not-enough-players return machine-readable codes', async () => {
      h.rooms.clear();
      const roomId = await h.createRoomWith(A!, [B!, C!, D!, E!, F!]);
      const full = await h.call(G!, { action: 'join', roomId, name: 'late' });
      assert.equal(full.status, 409);
      const body = await h.json(full);
      assert.equal(body.code, 'ROOM_FULL');
      assert.match(body.error, /満員/u);

      const lone = await h.createRoomWith(A!, []);
      h.clock.now += 1_000;
      const notEnough = await h.json(await h.call(A!, { action: 'start', roomId: lone }));
      assert.equal(notEnough.code, 'NOT_ENOUGH_PLAYERS');

      const started = await h.createRoomWith(A!, [B!]);
      assert.equal((await h.call(A!, { action: 'start', roomId: started })).status, 200);
      const lateJoin = await h.json(await h.call(G!, { action: 'join', roomId: started, name: 'late' }));
      assert.equal(lateJoin.code, 'GAME_STARTED');
      const stale = await h.json(await h.call(A!, { action: 'next-hand', roomId: started, expectedVersion: -5 }));
      assert.equal(stale.code, 'STALE_VERSION');
    });

    await t.test('A-7: absent members of a waiting room free their seats and the host is handed over', async () => {
      h.rooms.clear();
      const roomId = await h.createRoomWith(A!, [B!, C!, D!, E!, F!]);
      h.clock.now += 61_000;
      // Only B returns; A (host) and the rest are absent.
      const stateRes = await h.call(B!, { action: 'state', roomId });
      assert.equal(stateRes.status, 200);
      const room = h.rooms.get(roomId)!;
      assert.deepEqual(room.state.members.map((m: { id: string }) => m.id), [B]);
      assert.equal(room.host_user_id, B);
      const join = await h.call(G!, { action: 'join', roomId, name: 'newcomer' });
      assert.equal(join.status, 200);
    });

    await t.test('A-4: a player who leaves keeps seat and chips and is dealt in again after rejoining', async () => {
      h.rooms.clear();
      const roomId = await h.createRoomWith(A!, [B!, C!]);
      assert.equal((await h.call(A!, { action: 'start', roomId })).status, 200);
      const left = await h.call(C!, { action: 'leave', roomId });
      assert.equal(left.status, 200);
      await h.playOutHand(roomId);
      let row = h.rooms.get(roomId)!;
      assert.equal(row.state.table.seats.length, 3, 'leaver keeps a seat');
      assert.equal(row.state.table.seats.reduce((s: number, x: { stack: number }) => s + x.stack, 0), 3_000, 'chips conserved');
      // Next hand without C: only two players are dealt.
      h.clock.now += 1_000;
      for (const user of [A!, B!]) await h.call(user, { action: 'state', roomId });
      assert.equal((await h.call(A!, { action: 'next-hand', roomId, expectedVersion: row.state.table.version })).status, 200);
      row = h.rooms.get(roomId)!;
      assert.deepEqual(row.state.table.hand.players.map((p: { id: string }) => p.id).sort(), [A, B].sort());
      await h.playOutHand(roomId);
      // C comes back and is dealt into the following hand.
      h.clock.now += 1_000;
      assert.equal((await h.call(C!, { action: 'join', roomId, name: 'c' })).status, 200);
      for (const user of [A!, B!]) await h.call(user, { action: 'state', roomId });
      row = h.rooms.get(roomId)!;
      assert.equal((await h.call(A!, { action: 'next-hand', roomId, expectedVersion: row.state.table.version })).status, 200);
      row = h.rooms.get(roomId)!;
      assert.equal(row.state.table.hand.players.some((p: { id: string }) => p.id === C), true);
      const total = row.state.table.hand.players.reduce((s: number, p: { stack: number; totalContribution: number }) => s + p.stack + p.totalContribution, 0);
      assert.equal(total, 3_000);
    });

    await t.test('A-4: start keeps members who were absent as sitting out and they can still join', async () => {
      h.rooms.clear();
      const roomId = await h.createRoomWith(A!, [B!, C!]);
      h.clock.now += 16_000;
      for (const user of [A!, B!]) await h.call(user, { action: 'state', roomId });
      assert.equal((await h.call(A!, { action: 'start', roomId })).status, 200);
      const row = h.rooms.get(roomId)!;
      assert.equal(row.state.members.find((m: { id: string }) => m.id === C).sittingOut, true);
      assert.equal(row.state.table.hand.players.some((p: { id: string }) => p.id === C), false);
      assert.equal((await h.call(C!, { action: 'join', roomId, name: 'c' })).status, 200);
      assert.equal(h.rooms.get(roomId)!.state.members.find((m: { id: string }) => m.id === C).sittingOut, false);
    });

    await t.test('A-9: an engine error while resolving a timeout never blocks leave or state', async () => {
      h.rooms.clear();
      const roomId = await h.createRoomWith(A!, [B!]);
      assert.equal((await h.call(A!, { action: 'start', roomId })).status, 200);
      const row = h.rooms.get(roomId)!;
      row.state.table.hand.bettingRound.actorId = 'ghost';
      row.state.table.turnDeadline = h.clock.now - 1;
      const originalError = console.error;
      console.error = () => undefined;
      try {
        assert.equal((await h.call(B!, { action: 'state', roomId })).status, 200);
        assert.equal((await h.call(B!, { action: 'leave', roomId })).status, 200);
      } finally { console.error = originalError; }
    });

    await t.test('A-8: tokens with a non-UUID sub, expired exp or non-authenticated role are rejected', async () => {
      h.rooms.clear();
      const roomId = await h.createRoomWith(A!, []);
      const exp = Math.floor(h.clock.now / 1_000) + 3_600;
      const bad = [
        h.jwt({ sub: 'not-a-uuid', role: 'authenticated', exp }),
        h.jwt({ sub: A, role: 'authenticated', exp: Math.floor(h.clock.now / 1_000) - 10 }),
        h.jwt({ sub: A, role: 'anon', exp }),
        h.jwt({ sub: A, role: 'authenticated' }),
        'garbage',
      ];
      for (const token of bad) {
        const res = await h.callRaw(token, { action: 'state', roomId });
        assert.equal(res.status, 401, token);
      }
      assert.equal((await h.call(A!, { action: 'state', roomId })).status, 200);
    });

    await t.test('T4-2: control / bidi characters are rejected, long names rejected, duplicate names are suffixed', async () => {
      h.rooms.clear();
      for (const name of ['evil\u202Ename', 'zero\u200Bwidth', 'line\nbreak', 'あ'.repeat(21)]) {
        const res = await h.call(A!, { action: 'create', name });
        assert.equal(res.status, 400, JSON.stringify(name));
      }
      const twenty = '😀'.repeat(20);
      assert.equal((await h.call(U(40), { action: 'create', name: twenty })).status, 200, 'length is counted in code points');
      const roomId = await h.createRoomWith(U(41), [U(42), U(43)], ['Taro', 'Taro', 'taro']);
      const names = h.rooms.get(roomId)!.state.members.map((m: { name: string }) => m.name);
      assert.deepEqual(names, ['Taro', 'Taro 2', 'taro 3']);
    });
  } finally {
    h.dispose();
  }
});

test('A-8: supabase/config.toml keeps verify_jwt = true for the rooms function', () => {
  const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(config, /\[functions\.rooms\][^[]*verify_jwt\s*=\s*true/u);
});
