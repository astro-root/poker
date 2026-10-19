import test from 'node:test';
import assert from 'node:assert/strict';

type StoredRoom = {
  id: string;
  host_user_id: string;
  status: 'waiting' | 'playing';
  revision: number;
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
  const identities: Record<string, string> = { host: 'host-user', guest: 'guest-user', outsider: 'outsider-user' };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    requests.push({ url: `${url.pathname}${url.search}`, method });
    if (url.pathname === '/auth/v1/user') {
      const token = new Headers(init.headers).get('Authorization')?.replace('Bearer ', '') ?? '';
      return reply(identities[token] ? { id: identities[token] } : { message: 'invalid token' }, identities[token] ? 200 : 401);
    }
    if (url.pathname !== '/rest/v1/poker_rooms') return reply({ message: 'not found' }, 404);
    if (databaseFailure) return reply({ message: databaseFailure }, 500);

    if (method === 'POST') {
      const row = JSON.parse(String(init.body)) as StoredRoom;
      rooms.set(row.id, row);
      return reply([row], 201);
    }
    const id = url.searchParams.get('id')?.replace(/^eq\./u, '');
    if (method === 'GET') return reply(id && rooms.has(id) ? [rooms.get(id)] : []);
    if (method === 'PATCH') {
      const row = id ? rooms.get(id) : undefined;
      const expectedRevision = Number(url.searchParams.get('revision')?.replace(/^eq\./u, ''));
      if (!row || row.revision !== expectedRevision) return reply([]);
      const update = JSON.parse(String(init.body)) as Partial<StoredRoom>;
      Object.assign(row, update);
      return reply([row]);
    }
    if (method === 'DELETE') {
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
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
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
    const reconnected = await call('guest', { action: 'state', roomId });
    assert.equal(reconnected.status, 200);

    const startedResponse = await call('host', { action: 'start', roomId });
    assert.equal(startedResponse.status, 200);
    const started = await startedResponse.json() as { room: { status: string; table: { hand: { players: Array<{ id: string; holeCards: unknown }> } } } };
    assert.equal(started.room.status, 'playing');
    assert.equal(started.room.table.hand.players.find((player) => player.id === 'host-user')?.holeCards instanceof Array, true);
    assert.equal(started.room.table.hand.players.find((player) => player.id === 'guest-user')?.holeCards, null);
    const startedStateForInputChecks = structuredClone(rooms.get(roomId)!.state);

    const initialTable = rooms.get(roomId)!.state.table as { version: number; turnDeadline: number; hand: { bettingRound: { actorId: string } } };
    assert.equal(initialTable.turnDeadline, now + 45_000);
    if (initialTable.hand.bettingRound.actorId === 'host-user') {
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
    assert.equal(afterTimeout.hand.bettingRound?.actorId, 'guest-user');
    const wager = await call('guest', { action: 'action', roomId, expectedVersion: afterTimeout.version, pokerAction: { type: 'bet', to: 20 } });
    assert.equal(wager.status, 200);
    const facingBet = rooms.get(roomId)!.state.table as { turnDeadline: number; version: number; hand: { bettingRound: { actorId: string } } };
    assert.equal(facingBet.hand.bettingRound.actorId, 'host-user');
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
    assert.ok(state.room.table.hand.players.find((player) => player.id === 'guest-user')?.holeCards instanceof Array);
    assert.equal(state.room.table.hand.players.find((player) => player.id === 'host-user')?.holeCards, null);

    const leavingUser = 'host-user';
    const leavingToken = leavingUser === 'host-user' ? 'host' : 'guest';
    const left = await call(leavingToken, { action: 'leave', roomId });
    assert.equal(left.status, 200);
    assert.equal(rooms.get(roomId)!.host_user_id, leavingUser === 'host-user' ? 'guest-user' : 'host-user');
    const departed = rooms.get(roomId)!.state.members.find((member: { id: string }) => member.id === leavingUser) as { sittingOut?: boolean };
    assert.equal(departed.sittingOut, true);
    assert.equal((rooms.get(roomId)!.state.table as { hand: { stage: string } }).hand.stage, 'complete',
      'leaving outside the current turn must fold the player immediately');

    rooms.get(roomId)!.state = startedStateForInputChecks;
    const table = rooms.get(roomId)!.state.table as { version: number; hand: { bettingRound: { actorId: string } } };
    now = (rooms.get(roomId)!.state.table as { turnDeadline: number }).turnDeadline - 1;
    const actorToken = table.hand.bettingRound.actorId === 'host-user' ? 'host' : 'guest';
    const invalidActions: unknown[] = [undefined, null, 'call', 42, {}, { type: 'bogus' }, { type: 'CALL' },
      { type: 'raise' }, { type: 'raise', to: '30' }, { type: 'raise', to: 30.5 },
      { type: 'raise', to: Number.NaN }, { type: 'raise', to: Number.POSITIVE_INFINITY }, { type: 'raise', to: -5 }];
    for (const pokerAction of invalidActions) {
      const revision = rooms.get(roomId)!.revision;
      const snapshot = JSON.stringify(rooms.get(roomId)!.state.table);
      const invalidResponse = await call(actorToken, { action: 'action', roomId, expectedVersion: table.version, pokerAction });
      assert.equal(invalidResponse.status, 400, `invalid action should be rejected: ${String(JSON.stringify(pokerAction))}`);
      assert.equal(rooms.get(roomId)!.revision, revision);
      assert.equal(JSON.stringify(rooms.get(roomId)!.state.table), snapshot);
    }
    const invalidVersions: unknown[] = [undefined, null, '2', 1.5, Number.NaN, Number.POSITIVE_INFINITY];
    for (const expectedVersion of invalidVersions) {
      const revision = rooms.get(roomId)!.revision;
      const snapshot = JSON.stringify(rooms.get(roomId)!.state.table);
      const invalidResponse = await call(actorToken, { action: 'action', roomId, expectedVersion, pokerAction: { type: 'call' } });
      assert.equal(invalidResponse.status, 400, `invalid version should be rejected: ${String(expectedVersion)}`);
      assert.equal(rooms.get(roomId)!.revision, revision);
      assert.equal(JSON.stringify(rooms.get(roomId)!.state.table), snapshot);
    }
    const currentRevision = rooms.get(roomId)!.revision;
    const currentTable = JSON.stringify(rooms.get(roomId)!.state.table);
    const illegalAction = await call(actorToken, { action: 'action', roomId, expectedVersion: table.version, pokerAction: { type: 'raise', to: 0 } });
    assert.equal(illegalAction.status, 422);
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
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    delete (globalThis as typeof globalThis & { Deno?: unknown }).Deno;
  }
});
