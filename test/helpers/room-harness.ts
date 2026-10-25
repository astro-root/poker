import assert from 'node:assert/strict';

export type StoredRoom = {
  id: string; host_user_id: string; status: 'waiting' | 'playing' | 'finished';
  revision: number; updated_at?: string; state: Record<string, any>;
};

export const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Minimal Supabase REST + Edge runtime mock shared by the room tests. */
export async function createHarness() {
  const rooms = new Map<string, StoredRoom>();
  const writes: string[] = [];
  const clock = { now: 1_800_000_000_000 };
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  Date.now = () => clock.now;
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    if (url.pathname === '/rest/v1/rpc/consume_room_rate_limit') return reply(true);
    if (url.pathname !== '/rest/v1/poker_rooms') return reply({ message: 'not found' }, 404);
    if (method !== 'GET') writes.push(method);
    const id = url.searchParams.get('id')?.replace(/^eq\./u, '');
    if (method === 'POST') {
      const row = JSON.parse(String(init.body)) as StoredRoom;
      if ((row as { code?: string }).code && [...rooms.values()].some((other) => (other as { code?: string }).code === (row as { code?: string }).code)) return reply({ message: 'duplicate key value violates unique constraint (23505)' }, 409);
      row.updated_at = new Date(clock.now).toISOString();
      rooms.set(row.id, row);
      return reply([row], 201);
    }
    if (method === 'GET') {
      if (id) return reply(rooms.has(id) ? [rooms.get(id)] : []);
      const code = url.searchParams.get('code')?.replace(/^eq\./u, '');
      if (code) return reply([...rooms.values()].filter((row) => (row as { code?: string }).code === code));
      const hostId = url.searchParams.get('host_user_id')?.replace(/^eq\./u, '');
      return reply([...rooms.values()].filter((row) => (!hostId || row.host_user_id === hostId) && row.status !== 'finished').map((row) => ({ id: row.id })));
    }
    if (method === 'PATCH') {
      const row = id ? rooms.get(id) : undefined;
      const expected = Number(url.searchParams.get('revision')?.replace(/^eq\./u, ''));
      if (!row || row.revision !== expected) return reply([]);
      Object.assign(row, JSON.parse(String(init.body)));
      return reply([row]);
    }
    if (method === 'DELETE') {
      if (!id) return reply([]);
      const row = rooms.get(id);
      if (!row) return reply([]);
      rooms.delete(id);
      return reply([row]);
    }
    return reply({ message: 'unsupported' }, 405);
  };
  Object.assign(globalThis, {
    Deno: {
      env: { get: (key: string) => ({ SUPABASE_URL: 'https://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[key] },
      serve: (callback: (request: Request) => Promise<Response>) => { handler = callback; },
    },
  });
  await import('../../supabase/functions/rooms/index.ts');
  assert.ok(handler, 'handler registered');

  const jwt = (claims: Record<string, unknown>): string =>
    `h.${btoa(JSON.stringify(claims)).replace(/=/gu, '').replace(/\+/gu, '-').replace(/\//gu, '_')}.s`;
  const tokenFor = (userId: string): string => jwt({ sub: userId, role: 'authenticated', exp: Math.floor(clock.now / 1_000) + 3_600 });
  const callRaw = (token: string, body: unknown) => handler!(new Request('https://edge.test/rooms', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  const call = (userId: string, body: unknown) => callRaw(tokenFor(userId), body);
  const json = async (response: Response) => await response.json() as any;

  async function createRoomWith(host: string, others: string[], names?: string[]): Promise<string> {
    const created = await json(await call(host, { action: 'create', name: names?.[0] ?? 'host' }));
    const roomId = created.room.roomId as string;
    for (const [index, user] of others.entries()) {
      const response = await call(user, { action: 'join', roomId, name: names?.[index + 1] ?? `p${index + 1}` });
      assert.equal(response.status, 200);
    }
    return roomId;
  }

  /** Plays the current hand to completion with check/call from whoever is on turn. */
  async function playOutHand(roomId: string): Promise<void> {
    for (let step = 0; step < 200; step++) {
      const row = rooms.get(roomId)!;
      const hand = row.state.table.hand;
      if (hand.stage === 'complete') return;
      const actor = hand.bettingRound.actorId as string;
      const facing = hand.bettingRound.currentBet - hand.players.find((p: any) => p.id === actor).streetContribution;
      clock.now += 1_100;
      const response = await call(actor, { action: 'action', roomId, expectedVersion: row.state.table.version, pokerAction: { type: facing > 0 ? 'call' : 'check' } });
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    }
    assert.fail('hand did not finish');
  }

  const dispose = (): void => {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    delete (globalThis as typeof globalThis & { Deno?: unknown }).Deno;
  };
  return { rooms, writes, clock, call, callRaw, json, jwt, createRoomWith, playOutHand, dispose };
}
