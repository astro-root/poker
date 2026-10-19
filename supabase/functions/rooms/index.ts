import { applyTableAction, createTable, startNextHand, type TableState } from '../../../src/poker/table.ts';
import type { BettingAction } from '../../../src/poker/betting.ts';

type Member = Readonly<{ id: string; name: string }>;
type RoomState = Readonly<{ members: readonly Member[]; notice: string; table: TableState | null }>;
type RoomRow = Readonly<{ id: string; host_user_id: string; status: 'waiting' | 'playing'; revision: number; state: RoomState }>;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') return 'プレイヤー';
  return value.trim().slice(0, 20) || 'プレイヤー';
}

async function supabaseRequest<T>(url: string, key: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('apikey', key);
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${key}`);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const result = await fetch(`${url}${path}`, { ...init, headers });
  const text = await result.text();
  let payload: unknown;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!result.ok) {
    const detail = payload && typeof payload === 'object' && 'message' in payload
      ? String((payload as { message: unknown }).message) : `Supabase request failed (${result.status})`;
    throw new Error(detail);
  }
  return payload as T;
}

async function getRoom(url: string, serviceKey: string, roomId: string): Promise<RoomRow | null> {
  const rows = await supabaseRequest<RoomRow[]>(url, serviceKey,
    `/rest/v1/poker_rooms?id=eq.${encodeURIComponent(roomId)}&select=*`);
  return rows[0] ?? null;
}

async function saveRoom(url: string, serviceKey: string, row: RoomRow, state: RoomState, status = row.status): Promise<RoomRow | null> {
  const rows = await supabaseRequest<RoomRow[]>(url, serviceKey,
    `/rest/v1/poker_rooms?id=eq.${encodeURIComponent(row.id)}&revision=eq.${row.revision}&select=*`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ state, status, revision: row.revision + 1, updated_at: new Date().toISOString() }),
    });
  return rows[0] ?? null;
}

function publicRoom(row: RoomRow, viewerId: string) {
  const room = row.state;
  let table: unknown = null;
  if (room.table) {
    const full = room.table;
    const revealed = full.hand?.result?.type === 'showdown'
      ? new Set(Object.keys(full.hand.result.settlement.hands)) : new Set<string>();
    // Keep the engine fields needed to render legal actions, but remove deck and every other player's cards.
    table = {
      ...full,
      hand: full.hand ? {
        ...full.hand,
        deck: [],
        players: full.hand.players.map((player) => ({
          ...player,
          holeCards: player.id === viewerId || revealed.has(player.id) ? player.holeCards : null,
        })),
      } : null,
    };
  }
  return {
    roomId: row.id,
    hostId: row.host_user_id,
    status: row.status,
    version: row.state.table?.version ?? 0,
    peers: room.members.map((member) => ({ ...member, connected: true })),
    table,
    notice: room.notice,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return response({ ok: false, error: 'POST only' }, 405);
  try {
    const authorization = request.headers.get('Authorization') ?? '';
    const token = authorization.replace(/^Bearer\s+/iu, '');
    if (!token) return response({ ok: false, error: 'ログイン状態を確認できません。' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    let authUser: { id: string };
    try {
      authUser = await supabaseRequest<{ id: string }>(url, anonKey, '/auth/v1/user', {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      return response({ ok: false, error: 'ログイン状態を確認できません。' }, 401);
    }
    if (!authUser?.id) return response({ ok: false, error: 'ログイン状態を確認できません。' }, 401);
    const userId = authUser.id;
    const body = await request.json();
    const action = body?.action;

    if (action === 'create') {
      const bytes = new Uint8Array(18);
      crypto.getRandomValues(bytes);
      const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      const state: RoomState = { members: [{ id: userId, name: cleanName(body.name) }], notice: '招待リンクを共有して友だちを待っています。', table: null };
      const rows = await supabaseRequest<RoomRow[]>(url, serviceKey, '/rest/v1/poker_rooms?select=*', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ id, host_user_id: userId, status: 'waiting', revision: 0, state }),
      });
      return response({ ok: true, room: publicRoom(rows[0], userId) });
    }

    const roomId = typeof body?.roomId === 'string' ? body.roomId : '';
    if (!/^[a-f0-9]{36}$/u.test(roomId)) return response({ ok: false, error: '招待リンクが正しくありません。' }, 400);
    const found = await getRoom(url, serviceKey, roomId);
    if (!found) return response({ ok: false, error: 'ルームが見つかりません。ホストに新しい招待リンクを頼んでください。' }, 404);
    let row = found as RoomRow;

    if (action === 'join') {
      const member = row.state.members.find((entry) => entry.id === userId);
      if (!member) {
        if (row.status !== 'waiting') return response({ ok: false, error: 'この対戦はすでに始まっています。' }, 409);
        if (row.state.members.length >= 6) return response({ ok: false, error: 'このルームは満員です（最大6人）。' }, 409);
        const state = { ...row.state, members: [...row.state.members, { id: userId, name: cleanName(body.name) }], notice: `${cleanName(body.name)}が参加しました。` };
        const data = await saveRoom(url, serviceKey, row, state);
        if (!data) return response({ ok: false, error: 'ルームが更新されました。もう一度参加してください。' }, 409);
        row = data as RoomRow;
      }
      return response({ ok: true, room: publicRoom(row, userId) });
    }

    if (action === 'leave') {
      if (!row.state.members.some((member) => member.id === userId)) {
        return response({ ok: false, error: 'このルームの参加者ではありません。' }, 403);
      }
      // Keep active players in the room so they can reconnect to an ongoing hand.
      if (row.status === 'playing') return response({ ok: true, room: publicRoom(row, userId) });
      const members = row.state.members.filter((member) => member.id !== userId);
      if (members.length === 0) {
        const deleted = await supabaseRequest<RoomRow[]>(url, serviceKey,
          `/rest/v1/poker_rooms?id=eq.${encodeURIComponent(row.id)}&revision=eq.${row.revision}`, {
            method: 'DELETE', headers: { Prefer: 'return=representation' },
          });
        if (!deleted.length) return response({ ok: false, error: 'ルームの状態が更新されました。もう一度お試しください。' }, 409);
        return response({ ok: true, room: null });
      }
      const state: RoomState = { ...row.state, members, notice: `${row.state.members.find((member) => member.id === userId)?.name ?? 'プレイヤー'}が退出しました。` };
      const rows = await supabaseRequest<RoomRow[]>(url, serviceKey,
        `/rest/v1/poker_rooms?id=eq.${encodeURIComponent(row.id)}&revision=eq.${row.revision}&select=*`, {
          method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ state, host_user_id: row.host_user_id === userId ? members[0].id : row.host_user_id,
            revision: row.revision + 1, updated_at: new Date().toISOString() }),
        });
      if (!rows.length) return response({ ok: false, error: 'ルームの状態が更新されました。もう一度お試しください。' }, 409);
      return response({ ok: true, room: publicRoom(rows[0], userId) });
    }

    if (!row.state.members.some((member) => member.id === userId)) return response({ ok: false, error: 'このルームの参加者ではありません。' }, 403);
    if (action === 'state') return response({ ok: true, room: publicRoom(row, userId) });

    let nextState: RoomState;
    let status = row.status;
    if (action === 'start') {
      if (row.host_user_id !== userId) return response({ ok: false, error: '対戦を開始できるのはホストです。' }, 403);
      if (row.status !== 'waiting' || row.state.members.length < 2) return response({ ok: false, error: '2人以上が参加してから開始してください。' }, 409);
      let table = createTable(row.state.members.map((member) => ({ id: member.id, stack: 1_000 })), 5, 10);
      table = startNextHand(table);
      nextState = { ...row.state, table, notice: 'ホストが対戦を開始しました。' };
      status = 'playing';
    } else if (action === 'action') {
      if (row.status !== 'playing' || !row.state.table?.hand?.bettingRound) return response({ ok: false, error: '現在は操作できません。' }, 409);
      const table = row.state.table;
      if (table.hand.bettingRound.actorId !== userId) return response({ ok: false, error: 'まだあなたの番ではありません。' }, 409);
      const pokerAction = body.pokerAction as BettingAction;
      const nextTable = applyTableAction(table, Number(body.expectedVersion), userId, pokerAction);
      nextState = { ...row.state, table: nextTable, notice: `${row.state.members.find((member) => member.id === userId)?.name ?? 'プレイヤー'}がアクションしました。` };
    } else if (action === 'next-hand') {
      if (row.host_user_id !== userId) return response({ ok: false, error: '次のハンドを開始できるのはホストです。' }, 403);
      if (row.status !== 'playing' || !row.state.table) return response({ ok: false, error: '現在は次のハンドを開始できません。' }, 409);
      const table = row.state.table;
      if (Number(body.expectedVersion) !== table.version) return response({ ok: false, error: '画面が更新されています。状態を更新してください。' }, 409);
      const nextTable = startNextHand(table);
      nextState = { ...row.state, table: nextTable, notice: '次のハンドが始まりました。' };
    } else return response({ ok: false, error: '操作が正しくありません。' }, 400);

    const updated = await saveRoom(url, serviceKey, row, nextState, status);
    if (!updated) return response({ ok: false, error: '同時に操作がありました。最新の状態に更新してください。' }, 409);
    return response({ ok: true, room: publicRoom(updated as RoomRow, userId) });
  } catch (error) {
    console.error('rooms function error', error);
    const message = error instanceof Error ? error.message : 'ルーム操作に失敗しました。';
    return response({ ok: false, error: message }, 400);
  }
});
