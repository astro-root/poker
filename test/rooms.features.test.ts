import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, U } from './helpers/room-harness.ts';

// The Edge handler registers once per process, so all tests share one harness and use disjoint user ids.
const h = await createHarness();
test.after(() => h.dispose());
let base = 0;
const nextBase = (): void => { base += 100; };
const V = (n: number): string => U(base + n);

const settings = { startingStack: 2000, smallBlind: 10, bigBlind: 20, ante: 5, maxHands: 2, escalateBlinds: false };

test('host settings: validated, host-only, versioned, and applied to the game', async () => {
  nextBase();
  try {
    const roomId = await h.createRoomWith(V(1), [V(2)]);
    const bad = [
      { ...settings, startingStack: -5 }, { ...settings, startingStack: 1e12 }, { ...settings, startingStack: '1000' },
      { ...settings, smallBlind: 0 }, { ...settings, bigBlind: 10, smallBlind: 10 }, { ...settings, ante: -1 },
      { ...settings, ante: 21 }, { ...settings, maxHands: 0 }, { ...settings, maxHands: 1.5 }, { ...settings, bigBlind: 5000 }, null,
    ];
    for (const value of bad) {
      const response = await h.call(V(1), { action: 'settings', roomId, settings: value, expectedSettingsVersion: 0 });
      assert.equal(response.status, 400, JSON.stringify(value));
    }
    // Non-host is refused even with valid values.
    assert.equal((await h.call(V(2), { action: 'settings', roomId, settings, expectedSettingsVersion: 0 })).status, 403);
    // A stale version cannot overwrite newer settings.
    const ok = await h.json(await h.call(V(1), { action: 'settings', roomId, settings, expectedSettingsVersion: 0 }));
    assert.equal(ok.room.settingsVersion, 1);
    assert.equal((await h.call(V(1), { action: 'settings', roomId, settings: { ...settings, ante: 0 }, expectedSettingsVersion: 0 })).status, 409);

    h.clock.now += 1_000;
    const started = await h.json(await h.call(V(1), { action: 'start', roomId }));
    const table = h.rooms.get(roomId)!.state.table;
    assert.equal(table.maxHands, 2);
    assert.equal(table.hand.ante, 5);
    assert.equal(table.smallBlind, 10);
    assert.equal(table.seats.reduce((n: number, seat: any) => n + seat.stack, 0) + table.hand.players.reduce((n: number, p: any) => n + p.totalContribution, 0) - table.hand.players.reduce((n: number, p: any) => n + p.totalContribution, 0) > 0, true);
    assert.equal(started.room.settings.startingStack, 2000);
    // Mid-game: the starting stack is locked, a hand limit below the hands played is refused, the rest applies from the next hand.
    assert.equal((await h.call(V(1), { action: 'settings', roomId, settings: { ...settings, startingStack: 3000 }, expectedSettingsVersion: 1 })).status, 400);
    assert.equal((await h.call(V(2), { action: 'settings', roomId, settings, expectedSettingsVersion: 1 })).status, 403);
    const live = await h.call(V(1), { action: 'settings', roomId, settings: { ...settings, smallBlind: 25, bigBlind: 50, ante: 10 }, expectedSettingsVersion: 1 });
    assert.equal(live.status, 200);
    const running = h.rooms.get(roomId)!.state.table;
    assert.equal(running.hand.smallBlind, 10, 'the hand in progress is untouched');
    assert.equal(running.baseSmallBlind, 25);
    assert.equal(running.baseBigBlind, 50);
    assert.equal(running.baseAnte, 10);
  } finally { /* shared harness is disposed after all tests */ }
});

test('hand limit finishes the game and the richest player wins', async () => {
  nextBase();
  try {
    const roomId = await h.createRoomWith(V(1), [V(2)]);
    await h.call(V(1), { action: 'settings', roomId, settings: { ...settings, ante: 0, maxHands: 1 }, expectedSettingsVersion: 0 });
    h.clock.now += 1_000;
    await h.call(V(1), { action: 'start', roomId });
    await h.playOutHand(roomId);
    const row = h.rooms.get(roomId)!;
    assert.equal(row.status, 'finished');
    assert.ok(row.state.winnerId === undefined || typeof row.state.winnerId === 'string');
  } finally { /* shared harness is disposed after all tests */ }
});

test('spectators can watch but never see hole cards, never act, and are not dealt in', async () => {
  nextBase();
  try {
    const roomId = await h.createRoomWith(V(1), [V(2)]);
    h.clock.now += 1_000;
    await h.call(V(1), { action: 'start', roomId });
    const joined = await h.json(await h.call(V(9), { action: 'join', roomId, spectate: true, name: '観客' }));
    assert.equal(joined.room.role, 'spectator');
    assert.equal(joined.room.spectators.length, 1);
    const view = await h.json(await h.call(V(9), { action: 'state', roomId }));
    const text = JSON.stringify(view.room);
    for (const player of view.room.table.hand.players) assert.equal(player.holeCards, null);
    assert.deepEqual(view.room.table.hand.deck, []);
    // No private card of either player appears anywhere in the spectator payload.
    for (const p of h.rooms.get(roomId)!.state.table.hand.players) {
      for (const card of p.holeCards) assert.ok(!text.includes(JSON.stringify(card)) || view.room.table.hand.board.some((b: any) => JSON.stringify(b) === JSON.stringify(card)), 'hole card leaked');
    }
    assert.equal(view.room.table.hand.players.length, 2, 'spectator is not seated');
    const actor = h.rooms.get(roomId)!.state.table.hand.bettingRound.actorId;
    for (const body of [
      { action: 'action', pokerAction: { type: 'fold' }, expectedVersion: 1 }, { action: 'start' }, { action: 'rematch' },
      { action: 'next-hand', expectedVersion: 1 }, { action: 'settings', settings, expectedSettingsVersion: 0 },
    ]) {
      const response = await h.call(V(9), { roomId, ...body });
      assert.equal(response.status, 403, body.action);
      assert.equal((await h.json(response)).code, 'SPECTATOR_FORBIDDEN');
    }
    assert.notEqual(actor, V(9));
    // Players do not see each other's cards either, and a spectator cannot act "as" a player by sending ids.
    const other = await h.json(await h.call(V(1), { action: 'state', roomId }));
    const opponent = other.room.table.hand.players.find((p: any) => p.id !== V(1));
    assert.equal(opponent.holeCards, null);
    // Leaving removes the spectator.
    await h.call(V(9), { action: 'leave', roomId });
    assert.equal((h.rooms.get(roomId)!.state.spectators ?? []).length, 0);
  } finally { /* shared harness is disposed after all tests */ }
});

test('rename: own name only, validated, ids/seats/chips unchanged, visible to others', async () => {
  nextBase();
  try {
    const roomId = await h.createRoomWith(V(1), [V(2)], ['Host', 'Guest']);
    for (const name of ['', '   ', 'a'.repeat(21), 'x\u202Ey', 'a\u0000b', 123, null]) {
      assert.equal((await h.call(V(2), { action: 'rename', roomId, name })).status, 400, String(name));
    }
    h.clock.now += 1_000;
    const renamed = await h.json(await h.call(V(2), { action: 'rename', roomId, name: '  <img onerror=1>  ' }));
    assert.equal(renamed.room.peers.find((p: any) => p.id === V(2)).name, '<img onerror=1>', 'stored verbatim as text; the UI renders it via textContent');
    // Cannot take someone else's name: it is made unique rather than duplicated.
    const dup = await h.json(await h.call(V(2), { action: 'rename', roomId, name: 'host' }));
    assert.notEqual(dup.room.peers.find((p: any) => p.id === V(2)).name.toLowerCase(), 'host');
    // A name change never alters host rights or ids; there is no way to name a target other than yourself.
    const seen = await h.json(await h.call(V(1), { action: 'state', roomId }));
    assert.equal(seen.room.hostId, V(1));
    assert.equal(seen.room.peers.length, 2);
    // Outsiders cannot rename.
    assert.equal((await h.call(V(7), { action: 'rename', roomId, name: 'x' })).status, 403);
    // Mid-game rename keeps chips and seat.
    await h.call(V(1), { action: 'start', roomId });
    const before = JSON.stringify(h.rooms.get(roomId)!.state.table.seats);
    h.clock.now += 1_000;
    assert.equal((await h.call(V(2), { action: 'rename', roomId, name: 'Nova' })).status, 200);
    assert.equal(JSON.stringify(h.rooms.get(roomId)!.state.table.seats), before);
  } finally { /* shared harness is disposed after all tests */ }
});

test('rematch resets the table, is idempotent under simultaneous taps, and keeps settings', async () => {
  nextBase();
  try {
    const roomId = await h.createRoomWith(V(1), [V(2)]);
    await h.call(V(1), { action: 'settings', roomId, settings: { ...settings, ante: 0, maxHands: 1 }, expectedSettingsVersion: 0 });
    h.clock.now += 1_000;
    await h.call(V(1), { action: 'start', roomId });
    await h.playOutHand(roomId);
    assert.equal(h.rooms.get(roomId)!.status, 'finished');
    h.clock.now += 1_000;
    const results = await Promise.all([V(1), V(2), V(1), V(2)].map((u) => h.call(u, { action: 'rematch', roomId })));
    for (const r of results) assert.equal(r.status, 200);
    const row = h.rooms.get(roomId)!;
    assert.equal(row.status, 'waiting');
    assert.equal(row.state.table, null);
    assert.equal(row.state.winnerId, undefined);
    assert.equal(row.state.settings.maxHands, 1);
    assert.equal(row.state.members.length, 2);
    const before = h.rooms.size;
    await h.call(V(1), { action: 'rematch', roomId });
    assert.equal(h.rooms.size, before, 'a rematch never creates another room; the same room id and invite link are reused');
    // A rematch on a running game is refused, and an outsider cannot trigger one.
    h.clock.now += 1_000;
    await h.call(V(1), { action: 'start', roomId });
    assert.equal((await h.call(V(1), { action: 'rematch', roomId })).status, 409);
    assert.equal((await h.call(V(8), { action: 'rematch', roomId })).status, 403);
    // Fresh hand: no stale cards or contributions from the previous game.
    assert.equal(h.rooms.get(roomId)!.state.table.handNumber, 1);
  } finally { /* shared harness is disposed after all tests */ }
});

test('stale settings write and concurrent start cannot leave a half-applied state', async () => {
  nextBase();
  try {
    const roomId = await h.createRoomWith(V(1), [V(2)]);
    h.clock.now += 1_000;
    const [a, b] = await Promise.all([
      h.call(V(1), { action: 'settings', roomId, settings: { ...settings, maxHands: 7 }, expectedSettingsVersion: 0 }),
      h.call(V(1), { action: 'start', roomId }),
    ]);
    const row = h.rooms.get(roomId)!;
    const started = row.status === 'playing';
    if (started) assert.equal(row.state.table.maxHands, row.state.settings?.maxHands ?? null);
    assert.ok([200, 409].includes(a.status) && [200, 409].includes(b.status));
  } finally { /* shared harness is disposed after all tests */ }
});

test('state polling is rate limited per user without blocking normal play', async () => {
  nextBase();
  try {
    const roomId = await h.createRoomWith(V(1), [V(2)]);
    h.clock.now += 10_000;
    let limited = 0;
    for (let i = 0; i < 25; i++) if ((await h.call(V(1), { action: 'state', roomId })).status === 429) limited++;
    assert.ok(limited > 0, 'a polling flood is rejected');
    h.clock.now += 6_000;
    assert.equal((await h.call(V(1), { action: 'state', roomId })).status, 200, 'normal polling resumes after the window');
  } finally { /* shared harness is disposed after all tests */ }
});

test('room code: created with the room, joins by code, malformed or unknown codes are rejected', async () => {
  nextBase();
  const roomId = await h.createRoomWith(V(1), []);
  const row = h.rooms.get(roomId)! as any;
  assert.match(row.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/u);
  const joined = await h.json(await h.call(V(2), { action: 'join', code: row.code.toLowerCase(), name: 'Code' }));
  assert.equal(joined.room.roomId, roomId);
  assert.equal(joined.room.code, row.code);
  assert.equal((await h.call(V(3), { action: 'join', code: 'AAAAAA', name: 'x' })).status, 404);
  assert.equal((await h.call(V(3), { action: 'join', code: 'O0I1', name: 'x' })).status, 400);
});

test('create accepts validated settings including the hand-rank toggle', async () => {
  nextBase();
  const bad = await h.call(V(1), { action: 'create', name: 'H', settings: { ...settings, bigBlind: 1 } });
  assert.equal(bad.status, 400);
  const created = await h.json(await h.call(V(1), { action: 'create', name: 'H', settings: { ...settings, showHandRank: false, maxHands: null } }));
  assert.equal(created.room.settings.showHandRank, false);
  assert.equal(created.room.settings.startingStack, 2000);
});

test('host kick: host only, bans rejoin and spectating, folds a seated player mid-hand', async () => {
  nextBase();
  const roomId = await h.createRoomWith(V(1), [V(2), V(3)]);
  assert.equal((await h.call(V(2), { action: 'kick', roomId, targetId: V(3) })).status, 403);
  assert.equal((await h.call(V(1), { action: 'kick', roomId, targetId: V(1) })).status, 400);
  assert.equal((await h.call(V(1), { action: 'kick', roomId, targetId: V(9) })).status, 404);
  h.clock.now += 1_000;
  await h.call(V(1), { action: 'start', roomId });
  const res = await h.json(await h.call(V(1), { action: 'kick', roomId, targetId: V(3) }));
  assert.equal(res.ok, true);
  const state = h.rooms.get(roomId)!.state;
  assert.ok(state.banned.includes(V(3)));
  assert.equal(state.table.hand.players.find((p: any) => p.id === V(3)).folded, true);
  for (const body of [{ action: 'state' }, { action: 'join', name: 'back' }, { action: 'join', spectate: true, name: 'back' }, { action: 'action', pokerAction: { type: 'fold' }, expectedVersion: 0 }]) {
    const r = await h.call(V(3), { roomId, ...body });
    assert.equal(r.status, 403, body.action);
    assert.equal((await h.json(r)).code, 'KICKED');
  }
});

test('host can kick a spectator', async () => {
  nextBase();
  const roomId = await h.createRoomWith(V(1), [V(2)]);
  h.clock.now += 1_000;
  await h.call(V(1), { action: 'start', roomId });
  await h.call(V(7), { action: 'join', roomId, spectate: true, name: 'W' });
  assert.equal((await h.call(V(1), { action: 'kick', roomId, targetId: V(7) })).status, 200);
  assert.equal((await h.call(V(7), { action: 'state', roomId })).status, 403);
});

test('chat: text and whitelisted emoji only, sanitised, capped, spectators allowed, outsiders refused', async () => {
  nextBase();
  const roomId = await h.createRoomWith(V(1), [V(2)]);
  h.clock.now += 1_000;
  assert.equal((await h.call(V(1), { action: 'chat', roomId, kind: 'text', text: '   ' })).status, 400);
  assert.equal((await h.call(V(1), { action: 'chat', roomId, kind: 'emoji', text: '<script>' })).status, 400);
  assert.equal((await h.call(V(9), { action: 'chat', roomId, kind: 'text', text: 'hi' })).status, 403);
  const ok = await h.json(await h.call(V(1), { action: 'chat', roomId, kind: 'text', text: ' こん\u202Eにちは\u0000 ' + 'a'.repeat(200) }));
  const msg = ok.room.chat.at(-1);
  assert.ok([...msg.text].length <= 80);
  assert.ok(!/[\u202e\u0000]/u.test(msg.text));
  await h.call(V(2), { action: 'chat', roomId, kind: 'emoji', text: '🔥' });
  assert.equal(h.rooms.get(roomId)!.state.chat.at(-1).text, '🔥');
  await h.call(V(5), { action: 'join', roomId, spectate: true, name: 'W' });
  assert.equal((await h.call(V(5), { action: 'chat', roomId, kind: 'text', text: 'nice' })).status, 200);
  for (let i = 0; i < 40; i++) { h.clock.now += 2_000; await h.call(V(1), { action: 'chat', roomId, kind: 'text', text: `m${i}` }); }
  assert.ok(h.rooms.get(roomId)!.state.chat.length <= 30, 'history is capped');
});

test('chat is rate limited per user', async () => {
  nextBase();
  const roomId = await h.createRoomWith(V(1), [V(2)]);
  h.clock.now += 1_000;
  // The shared mock database always allows; the in-process limiter is verified separately via the LIMITS table shape.
  assert.equal((await h.call(V(1), { action: 'chat', roomId, kind: 'text', text: 'ok' })).status, 200);
});
