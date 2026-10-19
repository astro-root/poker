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
  const originalFetch = globalThis.fetch;
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const identities: Record<string, string> = { host: 'host-user', guest: 'guest-user' };
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

    const startedResponse = await call('host', { action: 'start', roomId });
    assert.equal(startedResponse.status, 200);
    const started = await startedResponse.json() as { room: { status: string; table: { hand: { players: Array<{ id: string; holeCards: unknown }> } } } };
    assert.equal(started.room.status, 'playing');
    assert.equal(started.room.table.hand.players.find((player) => player.id === 'host-user')?.holeCards instanceof Array, true);
    assert.equal(started.room.table.hand.players.find((player) => player.id === 'guest-user')?.holeCards, null);

    const stateResponse = await call('guest', { action: 'state', roomId });
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json() as { room: { table: { hand: { deck: unknown[]; players: Array<{ id: string; holeCards: unknown }> } } } };
    assert.deepEqual(state.room.table.hand.deck, []);
    assert.ok(state.room.table.hand.players.find((player) => player.id === 'guest-user')?.holeCards instanceof Array);
    assert.equal(state.room.table.hand.players.find((player) => player.id === 'host-user')?.holeCards, null);

    const table = rooms.get(roomId)!.state.table as { version: number; hand: { bettingRound: { actorId: string } } };
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

    assert.ok(requests.some((request) => request.method === 'PATCH' && request.url.includes('revision=eq.0')));
    assert.ok(requests.some((request) => request.method === 'PATCH' && request.url.includes('revision=eq.1')));
  } finally {
    globalThis.fetch = originalFetch;
    delete (globalThis as typeof globalThis & { Deno?: unknown }).Deno;
  }
});
