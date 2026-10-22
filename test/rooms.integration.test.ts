import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck } from '../src/poker/cards.ts';
import { createTable, startNextHand } from '../src/poker/table.ts';

const HOST = '00000000-0000-4000-8000-000000000001';
const GUEST = '00000000-0000-4000-8000-000000000002';
const OUTSIDER = '00000000-0000-4000-8000-000000000003';
const CAP = '00000000-0000-4000-8000-000000000004';

type StoredRoom = {
  id: string;
  host_user_id: string;
  status: 'waiting' | 'playing' | 'finished';
  revision: number;
  updated_at?: string;
  state: Record<string, any>;
};

test('rooms Edge handler round-trips create, join, start, and private state through mocked Supabase', async () => {
  const rooms = new Map<string, StoredRoom>();
  const requests: Array<{ url: string; method: string }> = [];
  let databaseFailure: string | null = null;
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const identities: Record<string, string> = { host: HOST, guest: GUEST, outsider: OUTSIDER, cap: CAP };
  const rateCounts = new Map<string, { second: number; count: number }>();
  const jwtFor = (alias: string) => {
    const payload = btoa(JSON.stringify({ sub: identities[alias] ?? alias, role: 'authenticated', exp: Math.floor(now / 1_000) + 3_600 })).replace(/=/gu, '').replace(/\+/gu, '-').replace(/\//gu, '_');
    return `header.${payload}.signature`;
  };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    requests.push({ url: `${url.pathname}${url.search}`, method });
    if (url.pathname === '/auth/v1/user') {
      const token = new Headers(init.headers).get('Authorization')?.replace('Bearer ', '') ?? '';
      return reply(identities[token] ? { id: identities[token] } : { message: 'invalid token' }, identities[token] ? 200 : 401);
    }
    if (url.pathname === '/rest/v1/rpc/consume_room_rate_limit') {
      const input = JSON.parse(String(init.body)) as { p_user_id: string };
      const second = Math.floor(now / 1_000);
      const previous = rateCounts.get(input.p_user_id);
      const count = previous?.second === second ? previous.count + 1 : 1;
      rateCounts.set(input.p_user_id, { second, count });
      return reply(count <= 10);
    }
    if (url.pathname !== '/rest/v1/poker_rooms') return reply({ message: 'not found' }, 404);
    if (databaseFailure) return reply({ message: databaseFailure }, 500);

    if (method === 'POST') {
      const row = JSON.parse(String(init.body)) as StoredRoom;
      row.updated_at = new Date(now).toISOString();
      rooms.set(row.id, row);
      return reply([row], 201);
    }
    const id = url.searchParams.get('id')?.replace(/^eq\./u, '');
    if (method === 'GET') {
      if (id) return reply(rooms.has(id) ? [rooms.get(id)] : []);
      const hostId = url.searchParams.get('host_user_id')?.replace(/^eq\./u, '');
      const statusFilter = url.searchParams.get('status')?.replace(/^(eq|neq)\./u, '');
      const statusOperator = url.searchParams.get('status')?.split('.')[0];
      const rows = [...rooms.values()].filter((row) => (!hostId || row.host_user_id === hostId)
        && (!statusFilter || (statusOperator === 'eq' ? row.status === statusFilter : row.status !== statusFilter)));
      return reply(url.searchParams.get('select') === 'id' ? rows.map((row) => ({ id: row.id })) : rows);
    }
    if (method === 'PATCH') {
      const row = id ? rooms.get(id) : undefined;
      const expectedRevision = Number(url.searchParams.get('revision')?.replace(/^eq\./u, ''));
      if (!row || row.revision !== expectedRevision) return reply([]);
      const update = JSON.parse(String(init.body)) as Partial<StoredRoom>;
      Object.assign(row, update);
      return reply([row]);
    }
    if (method === 'DELETE') {
      if (!id) {
        const status = url.searchParams.get('status')?.replace(/^(eq|neq)\./u, '');
        const statusOperator = url.searchParams.get('status')?.split('.')[0];
        const cutoff = Date.parse(url.searchParams.get('updated_at')?.replace(/^lt\./u, '') ?? '');
        for (const [roomKey, row] of rooms) {
          const statusMatches = !status || (statusOperator === 'eq' ? row.status === status : row.status !== status);
          if (statusMatches && Date.parse(row.updated_at ?? '') < cutoff) rooms.delete(roomKey);
        }
        return reply([]);
      }
      const row = id ? rooms.get(id) : undefined;
      if (!row) return reply([]);
      rooms.delete(row.id);
      return reply([row]);
    }
    return reply({ message: 'unsupported method' }, 405);
  };

  Object.assign(globalThis, {
    Deno: {
      env: { get: (key: string) => ({ SUPABASE_URL: 'https://supabase.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' })[key] },
      serve: (callback: (request: Request) => Promise<Response>) => { handler = callback; },
    },
  });

  try {
    await import('../supabase/functions/rooms/index.ts');
    assert.ok(handler, 'Deno.serve should register the rooms request handler');
    const call = async (token: string, body: unknown) => handler!(new Request('https://edge.test/rooms', {
      method: 'POST', headers: { Authorization: `Bearer ${jwtFor(token)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));

    const createdResponse = await call('host', { action: 'create', name: 'ホスト' });
    assert.equal(createdResponse.status, 200);
    const created = await createdResponse.json() as { room: { roomId: string; revision?: number; peers: unknown[] } };
    const roomId = created.room.roomId;
    assert.match(roomId, /^[a-f0-9]{36}$/u);
    assert.equal(created.room.peers.length, 1);

    const joinedResponse = await call('guest', { action: 'join', roomId, name: 'ゲスト' });
    assert.equal(joinedResponse.status, 200);
    assert.equal(rooms.get(roomId)?.revision, 1);
    assert.equal(rooms.get(roomId)?.state.members.length, 2);

    now += 16_000;
    const inactiveStart = await call('host', { action: 'start', roomId });
    assert.equal(inactiveStart.status, 409, 'start must exclude a member whose presence expired');
    const stateRequestStart = requests.length;
    const reconnected = await call('guest', { action: 'state', roomId, sinceRevision: rooms.get(roomId)!.revision });
    assert.equal(reconnected.status, 200);
    const unchanged = await reconnected.json() as { unchanged?: boolean; revision?: number; room?: unknown };
    assert.equal(unchanged.unchanged, true);
    assert.equal(unchanged.revision, rooms.get(roomId)!.revision);
    assert.equal('room' in unchanged, false);
    const stateRequests = requests.slice(stateRequestStart);
    assert.equal(stateRequests.length, 2, 'state polling should use only the room read and presence write');
    assert.deepEqual(stateRequests.map((entry) => entry.method).sort(), ['GET', 'PATCH']);

    const startedResponse = await call('host', { action: 'start', roomId });
    assert.equal(startedResponse.status, 200);
    const started = await startedResponse.json() as { room: { status: string; table: { hand: { players: Array<{ id: string; holeCards: unknown }> } } } };
    assert.equal(started.room.status, 'playing');
    assert.equal(started.room.table.hand.players.find((player) => player.id === HOST)?.holeCards instanceof Array, true);
    assert.equal(started.room.table.hand.players.find((player) => player.id === GUEST)?.holeCards, null);
    const startedStateForInputChecks = structuredClone(rooms.get(roomId)!.state);

    const initialTable = rooms.get(roomId)!.state.table as { version: number; turnDeadline: number; hand: { bettingRound: { actorId: string } } };
    assert.equal(initialTable.turnDeadline, now + 45_000);
    if (initialTable.hand.bettingRound.actorId === HOST) {
      const called = await call('host', { action: 'action', roomId, expectedVersion: initialTable.version, pokerAction: { type: 'call' } });
      assert.equal(called.status, 200);
    }
    const beforeTimeout = rooms.get(roomId)!.state.table as { version: number; turnDeadline: number; hand: { bettingRound: { actorId: string } | null } };
    now = beforeTimeout.turnDeadline + 1;
    const outsiderResponse = await call('outsider', { action: 'state', roomId });
    assert.equal(outsiderResponse.status, 403);
    assert.equal((rooms.get(roomId)!.state.table as { version: number }).version, beforeTimeout.version,
      'a non-member must not be able to trigger the turn timeout');
    const timeoutResponse = await call('guest', { action: 'state', roomId });
    assert.equal(timeoutResponse.status, 200);
    const afterTimeout = rooms.get(roomId)!.state.table as { version: number; turnDeadline: number | null; hand: { stage: string; bettingRound: { actorId: string } | null } };
    assert.ok(afterTimeout.version > beforeTimeout.version, 'a request should resolve an expired turn');
    assert.equal(afterTimeout.hand.stage, 'flop', 'a player with no amount to call should time out by checking');
    assert.equal(afterTimeout.hand.bettingRound?.actorId, GUEST);
    const wager = await call('guest', { action: 'action', roomId, expectedVersion: afterTimeout.version, pokerAction: { type: 'bet', to: 20 } });
    assert.equal(wager.status, 200);
    const facingBet = rooms.get(roomId)!.state.table as { turnDeadline: number; version: number; hand: { bettingRound: { actorId: string } } };
    assert.equal(facingBet.hand.bettingRound.actorId, HOST);
    now = facingBet.turnDeadline + 1;
    const foldResponse = await call('host', { action: 'state', roomId });
    assert.equal(foldResponse.status, 200);
    const afterFoldTimeout = rooms.get(roomId)!.state.table as { hand: { stage: string; result: { type: string } | null } };
    assert.equal(afterFoldTimeout.hand.stage, 'complete', 'a player facing a bet should time out by folding');
    assert.equal(afterFoldTimeout.hand.result?.type, 'uncontested');

    const completedTable = rooms.get(roomId)!.state.table as { version: number };
    const nonHostNextHand = await call('guest', { action: 'next-hand', roomId, expectedVersion: completedTable.version });
    assert.equal(nonHostNextHand.status, 200, 'any seated online player may start the next hand');
    assert.equal((rooms.get(roomId)!.state.table as { handNumber: number }).handNumber, 2);

    const stateResponse = await call('guest', { action: 'state', roomId });
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json() as { room: { table: { hand: { deck: unknown[]; players: Array<{ id: string; holeCards: unknown }> } } } };
    assert.deepEqual(state.room.table.hand.deck, []);
    assert.ok(state.room.table.hand.players.find((player) => player.id === GUEST)?.holeCards instanceof Array);
    assert.equal(state.room.table.hand.players.find((player) => player.id === HOST)?.holeCards, null);

    const leavingUser = HOST;
    const leavingToken = leavingUser === HOST ? 'host' : 'guest';
    const left = await call(leavingToken, { action: 'leave', roomId });
    assert.equal(left.status, 200);
    assert.equal(rooms.get(roomId)!.host_user_id, leavingUser === HOST ? GUEST : HOST);
    const departed = rooms.get(roomId)!.state.members.find((member: { id: string }) => member.id === leavingUser) as { sittingOut?: boolean };
    assert.equal(departed.sittingOut, true);
    assert.equal((rooms.get(roomId)!.state.table as { hand: { stage: string } }).hand.stage, 'complete',
      'leaving outside the current turn must fold the player immediately');

    rooms.get(roomId)!.state = startedStateForInputChecks;
    const table = rooms.get(roomId)!.state.table as { version: number; hand: { bettingRound: { actorId: string } } };
    now = (rooms.get(roomId)!.state.table as { turnDeadline: number }).turnDeadline - 30_000;
    const actorToken = table.hand.bettingRound.actorId === HOST ? 'host' : 'guest';
    const invalidActions: unknown[] = [undefined, null, 'call', 42, {}, { type: 'bogus' }, { type: 'CALL' },
      { type: 'raise' }, { type: 'raise', to: '30' }, { type: 'raise', to: 30.5 },
      { type: 'raise', to: Number.NaN }, { type: 'raise', to: Number.POSITIVE_INFINITY }, { type: 'raise', to: -5 }];
    for (const pokerAction of invalidActions) {
      now += 1_001;
      const revision = rooms.get(roomId)!.revision;
      const snapshot = JSON.stringify(rooms.get(roomId)!.state.table);
      const invalidResponse = await call(actorToken, { action: 'action', roomId, expectedVersion: table.version, pokerAction });
      assert.equal(invalidResponse.status, 400, `invalid action should be rejected: ${String(JSON.stringify(pokerAction))}`);
      assert.equal(rooms.get(roomId)!.revision, revision);
      assert.equal(JSON.stringify(rooms.get(roomId)!.state.table), snapshot);
    }
    const invalidVersions: unknown[] = [undefined, null, '2', 1.5, Number.NaN, Number.POSITIVE_INFINITY];
    for (const expectedVersion of invalidVersions) {
      now += 1_001;
      const revision = rooms.get(roomId)!.revision;
      const snapshot = JSON.stringify(rooms.get(roomId)!.state.table);
      const invalidResponse = await call(actorToken, { action: 'action', roomId, expectedVersion, pokerAction: { type: 'call' } });
      assert.equal(invalidResponse.status, 400, `invalid version should be rejected: ${String(expectedVersion)}`);
      assert.equal(rooms.get(roomId)!.revision, revision);
      assert.equal(JSON.stringify(rooms.get(roomId)!.state.table), snapshot);
    }
    const currentRevision = rooms.get(roomId)!.revision;
    const currentTable = JSON.stringify(rooms.get(roomId)!.state.table);
    now += 1_001;
    const illegalAction = await call(actorToken, { action: 'action', roomId, expectedVersion: table.version, pokerAction: { type: 'raise', to: 0 } });
    assert.equal(illegalAction.status, 422);
    now += 1_001;
    const staleAction = await call(actorToken, { action: 'action', roomId, expectedVersion: table.version - 1, pokerAction: { type: 'call' } });
    assert.equal(staleAction.status, 409);
    assert.equal(rooms.get(roomId)!.revision, currentRevision);
    assert.equal(JSON.stringify(rooms.get(roomId)!.state.table), currentTable);

    assert.ok(requests.some((request) => request.method === 'PATCH' && request.url.includes('revision=eq.0')));
    assert.ok(requests.some((request) => request.method === 'PATCH' && request.url.includes('revision=eq.1')));

    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      databaseFailure = 'Cannot read private_key at /srv/secrets.ts:42';
      const failedResponse = await call('host', { action: 'state', roomId });
      const failedBody = await failedResponse.json() as { error: string; requestId: string };
      assert.equal(failedResponse.status, 500);
      assert.match(failedBody.requestId, /^[0-9a-f-]{36}$/u);
      assert.doesNotMatch(JSON.stringify(failedBody), /Cannot read|private_key|\/srv\/|at /u);
      assert.match(failedBody.error, /エラー/u);
    } finally {
      databaseFailure = null;
      console.error = originalConsoleError;
    }

    const oldState = rooms.get(roomId)!.state;
    for (const member of oldState.members) {
      delete (member as { lastSeenAt?: number; sittingOut?: boolean }).lastSeenAt;
      delete (member as { lastSeenAt?: number; sittingOut?: boolean }).sittingOut;
    }
    delete (oldState.table as { turnDeadline?: number | null }).turnDeadline;
    const legacyResponse = await call('guest', { action: 'state', roomId });
    assert.equal(legacyResponse.status, 200, 'old room state without presence and deadline fields should still load');
    assert.equal((rooms.get(roomId)!.state.table as { turnDeadline?: number }).turnDeadline, now + 45_000);

    const terminalCreate = await call('host', { action: 'create', name: '終局テスト' });
    const terminalRoomId = (await terminalCreate.json() as { room: { roomId: string } }).room.roomId;
    await call('guest', { action: 'join', roomId: terminalRoomId, name: '対戦者' });
    const terminalStart = await call('host', { action: 'start', roomId: terminalRoomId });
    assert.equal(terminalStart.status, 200);
    const terminalTable = startNextHand(createTable([{ id: HOST, stack: 10 }, { id: GUEST, stack: 10 }], 5, 10));
    const hand = terminalTable.hand!;
    const hostCards = [{ rank: 14, suit: 'spades' }, { rank: 14, suit: 'hearts' }] as const;
    const guestCards = [{ rank: 13, suit: 'spades' }, { rank: 13, suit: 'hearts' }] as const;
    const board = [
      { rank: 2, suit: 'clubs' }, { rank: 3, suit: 'diamonds' }, { rank: 4, suit: 'clubs' },
      { rank: 8, suit: 'hearts' }, { rank: 9, suit: 'spades' },
    ];
    const burns = [{ rank: 6, suit: 'clubs' }, { rank: 7, suit: 'diamonds' }, { rank: 10, suit: 'clubs' }];
    const fixedKeys = new Set([...hostCards, ...guestCards, ...board, ...burns].map((card) => `${card.rank}:${card.suit}`));
    const fixedDeck = [burns[0]!, board[0]!, board[1]!, board[2]!, burns[1]!, board[3]!, burns[2]!, board[4]!,
      ...createDeck().filter((card) => !fixedKeys.has(`${card.rank}:${card.suit}`))];
    const riggedTable = { ...terminalTable, hand: { ...hand, deck: fixedDeck, players: hand.players.map((player) => ({
      ...player, holeCards: player.id === HOST ? hostCards : guestCards,
    })) } };
    rooms.get(terminalRoomId)!.state.table = riggedTable;
    const allIn = await call('host', { action: 'action', roomId: terminalRoomId, expectedVersion: riggedTable.version, pokerAction: { type: 'all-in' } });
    assert.equal(allIn.status, 200);
    const finished = rooms.get(terminalRoomId)!;
    assert.equal(finished.status, 'finished');
    assert.equal(finished.state.winnerId, HOST);
    const rematch = await call('guest', { action: 'rematch', roomId: terminalRoomId });
    assert.equal(rematch.status, 200, 'a seated player can request a rematch');
    assert.equal(rooms.get(terminalRoomId)!.status, 'waiting');
    assert.equal(rooms.get(terminalRoomId)!.state.table, null);
    assert.equal(rooms.get(terminalRoomId)!.state.winnerId, undefined);
    await call('guest', { action: 'leave', roomId: terminalRoomId });
    const finalLeave = await call('host', { action: 'leave', roomId: terminalRoomId });
    assert.equal(await finalLeave.json().then((body: { room: unknown }) => body.room), null);
    assert.equal(rooms.has(terminalRoomId), false);

    const staleWaiting = await call('host', { action: 'create', name: '期限切れ待機ルーム' });
    const staleWaitingId = (await staleWaiting.json() as { room: { roomId: string } }).room.roomId;
    const staleFinished = await call('host', { action: 'create', name: '期限切れ終了ルーム' });
    const staleFinishedId = (await staleFinished.json() as { room: { roomId: string } }).room.roomId;
    rooms.get(staleWaitingId)!.updated_at = new Date(now - 25 * 60 * 60 * 1_000).toISOString();
    rooms.get(staleFinishedId)!.status = 'finished';
    rooms.get(staleFinishedId)!.updated_at = new Date(now - 2 * 60 * 60 * 1_000).toISOString();
    const cleanupTrigger = await call('host', { action: 'create', name: '新規ルーム' });
    assert.equal(cleanupTrigger.status, 200);
    assert.equal(rooms.has(staleWaitingId), false);
    assert.equal(rooms.has(staleFinishedId), false);

    const cappedRooms: string[] = [];
    for (let index = 0; index < 3; index++) {
      const capped = await call('cap', { action: 'create', name: `上限${index}` });
      assert.equal(capped.status, 200);
      cappedRooms.push(((await capped.json()) as { room: { roomId: string } }).room.roomId);
    }
    const overLimitRoom = await call('cap', { action: 'create', name: '上限超過' });
    assert.equal(overLimitRoom.status, 429);
    assert.equal(cappedRooms.filter((id) => rooms.has(id)).length, 3);

    const rateStatuses: number[] = [];
    for (let index = 0; index < 11; index++) {
      const limited = await call('outsider', { action: 'action', roomId: 'invalid', expectedVersion: 0, pokerAction: { type: 'call' } });
      rateStatuses.push(limited.status);
    }
    assert.deepEqual(rateStatuses.slice(0, 10), Array(10).fill(400));
    assert.equal(rateStatuses[10], 429);
    assert.equal(requests.some((entry) => entry.url.includes('/auth/v1/user')), false,
      'verified JWT claims should replace a second Auth HTTP request');
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    delete (globalThis as typeof globalThis & { Deno?: unknown }).Deno;
  }
});
