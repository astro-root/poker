import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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
    const authClient = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return response({ ok: false, error: 'ログイン状態を確認できません。' }, 401);
    const userId = authData.user.id;
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await request.json();
    const action = body?.action;

    if (action === 'create') {
      const bytes = new Uint8Array(18);
      crypto.getRandomValues(bytes);
      const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      const state: RoomState = { members: [{ id: userId, name: cleanName(body.name) }], notice: '招待リンクを共有して友だちを待っています。', table: null };
      const { data, error } = await db.from('poker_rooms').insert({ id, host_user_id: userId, status: 'waiting', revision: 0, state }).select('*').single();
      if (error) throw error;
      return response({ ok: true, room: publicRoom(data as RoomRow, userId) });
    }

    const roomId = typeof body?.roomId === 'string' ? body.roomId : '';
    if (!/^[a-f0-9]{36}$/u.test(roomId)) return response({ ok: false, error: '招待リンクが正しくありません。' }, 400);
    const { data: found, error: readError } = await db.from('poker_rooms').select('*').eq('id', roomId).maybeSingle();
    if (readError) throw readError;
    if (!found) return response({ ok: false, error: 'ルームが見つかりません。ホストに新しい招待リンクを頼んでください。' }, 404);
    let row = found as RoomRow;

    if (action === 'join') {
      const member = row.state.members.find((entry) => entry.id === userId);
      if (!member) {
        if (row.status !== 'waiting') return response({ ok: false, error: 'この対戦はすでに始まっています。' }, 409);
        if (row.state.members.length >= 6) return response({ ok: false, error: 'このルームは満員です（最大6人）。' }, 409);
        const state = { ...row.state, members: [...row.state.members, { id: userId, name: cleanName(body.name) }], notice: `${cleanName(body.name)}が参加しました。` };
        const { data, error } = await db.from('poker_rooms').update({ state, revision: row.revision + 1, updated_at: new Date().toISOString() })
          .eq('id', row.id).eq('revision', row.revision).select('*').maybeSingle();
        if (error) throw error;
        if (!data) return response({ ok: false, error: 'ルームが更新されました。もう一度参加してください。' }, 409);
        row = data as RoomRow;
      }
      return response({ ok: true, room: publicRoom(row, userId) });
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

    const { data: updated, error: updateError } = await db.from('poker_rooms')
      .update({ state: nextState, status, revision: row.revision + 1, updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('revision', row.revision).select('*').maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return response({ ok: false, error: '同時に操作がありました。最新の状態に更新してください。' }, 409);
    return response({ ok: true, room: publicRoom(updated as RoomRow, userId) });
  } catch (error) {
    console.error('rooms function error', error);
    const message = error instanceof Error ? error.message : 'ルーム操作に失敗しました。';
    return response({ ok: false, error: message }, 400);
  }
});
