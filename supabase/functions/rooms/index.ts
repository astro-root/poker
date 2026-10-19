import { applyTableAction, createTable, startNextHand, type TableState } from '../../../src/poker/table.ts';
import { getLegalActions, type BettingAction } from '../../../src/poker/betting.ts';
import { foldHandPlayer } from '../../../src/poker/hand.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

type Member = Readonly<{ id: string; name: string; lastSeenAt?: number; sittingOut?: boolean }>;
type RoomTableState = TableState & Readonly<{ turnDeadline?: number | null }>;
type RoomState = Readonly<{ members: readonly Member[]; notice: string; table: RoomTableState | null }>;
type RoomRow = Readonly<{ id: string; host_user_id: string; status: 'waiting' | 'playing'; revision: number; state: RoomState }>;

const TURN_TIMEOUT_MS = 45_000;
const PRESENCE_TIMEOUT_MS = 15_000;

class RoomError extends Error {
  readonly status: number;
  readonly userMessage: string;

  constructor(status: number, userMessage: string) {
    super(userMessage);
    this.name = 'RoomError';
    this.status = status;
    this.userMessage = userMessage;
  }
}

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

function parseAction(value: unknown): BettingAction {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new RoomError(400, 'アクションの形式が正しくありません。');
  const type = (value as { type?: unknown }).type;
  switch (type) {
    case 'fold':
    case 'check':
    case 'call':
    case 'all-in':
      return { type };
    case 'bet':
    case 'raise': {
      const to = (value as { to?: unknown }).to;
      if (!Number.isSafeInteger(to) || (to as number) < 0) throw new RoomError(400, 'ベット額の形式が正しくありません。');
      return { type, to: to as number };
    }
    default:
      throw new RoomError(400, 'アクションの形式が正しくありません。');
  }
}

function parseExpectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value)) throw new RoomError(400, '画面の状態が正しくありません。更新してからお試しください。');
  return value as number;
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

function isConnected(member: Member, now: number): boolean {
  return !member.sittingOut && Number.isSafeInteger(member.lastSeenAt)
    && now - (member.lastSeenAt as number) < PRESENCE_TIMEOUT_MS;
}

function withTurnDeadline(table: TableState, now: number): RoomTableState {
  return { ...table, turnDeadline: table.hand?.bettingRound?.actorId ? now + TURN_TIMEOUT_MS : null };
}

function resolveExpiredTurn(state: RoomState, now: number): RoomState {
  const table = state.table;
  if (!table?.hand?.bettingRound?.actorId) return state;
  if (!Number.isSafeInteger(table.turnDeadline)) return { ...state, table: withTurnDeadline(table, now) };
  if ((table.turnDeadline as number) > now) return state;
  const actorId = table.hand.bettingRound.actorId;
  const legal = getLegalActions(table.hand.bettingRound, actorId);
  const action: BettingAction = legal.canCheck ? { type: 'check' } : { type: 'fold' };
  const nextTable = applyTableAction(table, table.version, actorId, action);
  return {
    ...state,
    table: withTurnDeadline(nextTable, now),
    notice: `${state.members.find((member) => member.id === actorId)?.name ?? 'プレイヤー'}の時間切れにより自動${action.type === 'check' ? 'チェック' : 'フォールド'}しました。`,
  };
}

function publicRoom(row: RoomRow, viewerId: string, now: number) {
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
    peers: room.members.map((member) => ({ id: member.id, name: member.name, connected: isConnected(member, now) })),
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
    let body: any;
    try { body = await request.json(); } catch {
      throw new RoomError(400, 'リクエストの形式が正しくありません。');
    }
    const action = body?.action;
    const now = Date.now();

    if (action === 'create') {
      const bytes = new Uint8Array(18);
      crypto.getRandomValues(bytes);
      const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      const state: RoomState = { members: [{ id: userId, name: cleanName(body.name), lastSeenAt: now }], notice: '招待リンクを共有して友だちを待っています。', table: null };
      const rows = await supabaseRequest<RoomRow[]>(url, serviceKey, '/rest/v1/poker_rooms?select=*', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ id, host_user_id: userId, status: 'waiting', revision: 0, state }),
      });
      return response({ ok: true, room: publicRoom(rows[0], userId, now) });
    }

    const roomId = typeof body?.roomId === 'string' ? body.roomId : '';
    if (!/^[a-f0-9]{36}$/u.test(roomId)) return response({ ok: false, error: '招待リンクが正しくありません。' }, 400);
    const found = await getRoom(url, serviceKey, roomId);
    if (!found) return response({ ok: false, error: 'ルームが見つかりません。ホストに新しい招待リンクを頼んでください。' }, 404);
    let row = found as RoomRow;

    const isMember = row.state.members.some((member) => member.id === userId);
    if (action !== 'join' && !isMember) return response({ ok: false, error: 'このルームの参加者ではありません。' }, 403);
    if (action === 'join' && !isMember && row.status !== 'waiting') {
      return response({ ok: false, error: 'この対戦はすでに始まっています。' }, 409);
    }

    const timedState = resolveExpiredTurn(row.state, now);
    if (timedState !== row.state) {
      const saved = await saveRoom(url, serviceKey, row, timedState);
      if (!saved) return response({ ok: false, error: 'ルームの状態が更新されました。もう一度お試しください。' }, 409);
      row = saved;
    }

    if (action === 'join') {
      const member = row.state.members.find((entry) => entry.id === userId);
      if (!member) {
        if (row.state.members.length >= 6) return response({ ok: false, error: 'このルームは満員です（最大6人）。' }, 409);
        const state = { ...row.state, members: [...row.state.members, { id: userId, name: cleanName(body.name), lastSeenAt: now }], notice: `${cleanName(body.name)}が参加しました。` };
        const data = await saveRoom(url, serviceKey, row, state);
        if (!data) return response({ ok: false, error: 'ルームが更新されました。もう一度参加してください。' }, 409);
        row = data as RoomRow;
      } else {
        const state = { ...row.state, members: row.state.members.map((entry) => entry.id === userId ? { ...entry, lastSeenAt: now, sittingOut: false } : entry) };
        const data = await saveRoom(url, serviceKey, row, state);
        if (!data) return response({ ok: false, error: 'ルームが更新されました。もう一度参加してください。' }, 409);
        row = data as RoomRow;
      }
      return response({ ok: true, room: publicRoom(row, userId, now) });
    }

    if (action === 'leave') {
      if (!row.state.members.some((member) => member.id === userId)) {
        return response({ ok: false, error: 'このルームの参加者ではありません。' }, 403);
      }
      const leaver = row.state.members.find((member) => member.id === userId)!;
      const members = row.status === 'playing'
        ? row.state.members.map((member) => member.id === userId
          ? { ...member, lastSeenAt: now - PRESENCE_TIMEOUT_MS, sittingOut: true }
          : member)
        : row.state.members.filter((member) => member.id !== userId);
      if (members.length === 0) {
        const deleted = await supabaseRequest<RoomRow[]>(url, serviceKey,
          `/rest/v1/poker_rooms?id=eq.${encodeURIComponent(row.id)}&revision=eq.${row.revision}`, {
            method: 'DELETE', headers: { Prefer: 'return=representation' },
          });
        if (!deleted.length) return response({ ok: false, error: 'ルームの状態が更新されました。もう一度お試しください。' }, 409);
        return response({ ok: true, room: null });
      }
      let table = row.state.table;
      if (row.status === 'playing' && table?.hand?.bettingRound) {
        const folded = foldHandPlayer(table.hand, userId);
        table = withTurnDeadline({ ...table, hand: folded }, now);
      }
      const nextHost = row.host_user_id === userId
        ? members.find((member) => isConnected(member, now))?.id ?? row.host_user_id
        : row.host_user_id;
      const state: RoomState = { ...row.state, members, table, notice: `${leaver.name}が退出しました。` };
      const rows = await supabaseRequest<RoomRow[]>(url, serviceKey,
        `/rest/v1/poker_rooms?id=eq.${encodeURIComponent(row.id)}&revision=eq.${row.revision}&select=*`, {
          method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ state, host_user_id: nextHost,
            revision: row.revision + 1, updated_at: new Date().toISOString() }),
        });
      if (!rows.length) return response({ ok: false, error: 'ルームの状態が更新されました。もう一度お試しください。' }, 409);
      return response({ ok: true, room: publicRoom(rows[0], userId, now) });
    }

    row = { ...row, state: { ...row.state, members: row.state.members.map((member) => member.id === userId ? { ...member, lastSeenAt: now } : member) } };
    if (action === 'state') {
      const saved = await saveRoom(url, serviceKey, row, row.state);
      if (!saved) return response({ ok: false, error: 'ルームの状態が更新されました。もう一度お試しください。' }, 409);
      return response({ ok: true, room: publicRoom(saved, userId, now) });
    }

    let nextState: RoomState;
    let status = row.status;
    if (action === 'start') {
      if (row.host_user_id !== userId) return response({ ok: false, error: '対戦を開始できるのはホストです。' }, 403);
      if (row.status !== 'waiting') return response({ ok: false, error: '2人以上が参加してから開始してください。' }, 409);
      const seated = row.state.members.filter((member) => isConnected(member, now));
      if (seated.length < 2) return response({ ok: false, error: '在席中のプレイヤーが2人以上必要です。' }, 409);
      const table = withTurnDeadline(startNextHand(createTable(seated.map((member) => ({ id: member.id, stack: 1_000 })), 5, 10)), now);
      nextState = { ...row.state, table, notice: 'ホストが対戦を開始しました。' };
      status = 'playing';
    } else if (action === 'action') {
      const table = row.state.table;
      if (row.status !== 'playing' || !table?.hand?.bettingRound) return response({ ok: false, error: '現在は操作できません。' }, 409);
      if (table.hand.bettingRound.actorId !== userId) return response({ ok: false, error: 'まだあなたの番ではありません。' }, 409);
      const pokerAction = parseAction(body.pokerAction);
      const expectedVersion = parseExpectedVersion(body.expectedVersion);
      if (expectedVersion !== table.version) throw new RoomError(409, '画面が更新されています。状態を更新してください。');
      let nextTable: TableState;
      try { nextTable = applyTableAction(table, expectedVersion, userId, pokerAction); } catch {
        throw new RoomError(422, 'そのアクションは実行できません。現在の状態を確認してください。');
      }
      nextTable = withTurnDeadline(nextTable, now);
      nextState = { ...row.state, table: nextTable, notice: `${row.state.members.find((member) => member.id === userId)?.name ?? 'プレイヤー'}がアクションしました。` };
    } else if (action === 'next-hand') {
      if (row.status !== 'playing' || !row.state.table) return response({ ok: false, error: '現在は次のハンドを開始できません。' }, 409);
      const requester = row.state.members.find((member) => member.id === userId);
      if (!requester || !isConnected(requester, now)) return response({ ok: false, error: '在席中のプレイヤーのみ次のハンドを開始できます。' }, 403);
      const table = row.state.table;
      const expectedVersion = parseExpectedVersion(body.expectedVersion);
      if (expectedVersion !== table.version) return response({ ok: false, error: '画面が更新されています。状態を更新してください。' }, 409);
      let nextTable: TableState;
      const seatedIds = new Set(row.state.members.filter((member) => !member.sittingOut).map((member) => member.id));
      try { nextTable = startNextHand({ ...table, seats: table.seats.filter((seat) => seatedIds.has(seat.id)) }); } catch {
        throw new RoomError(409, '次のハンドを開始できません。');
      }
      nextTable = withTurnDeadline(nextTable, now);
      nextState = { ...row.state, table: nextTable, notice: '次のハンドが始まりました。' };
    } else return response({ ok: false, error: '操作が正しくありません。' }, 400);

    const updated = await saveRoom(url, serviceKey, row, nextState, status);
    if (!updated) return response({ ok: false, error: '同時に操作がありました。最新の状態に更新してください。' }, 409);
    return response({ ok: true, room: publicRoom(updated as RoomRow, userId, now) });
  } catch (error) {
    if (error instanceof RoomError) return response({ ok: false, error: error.userMessage }, error.status);
    const requestId = crypto.randomUUID();
    console.error(`rooms function error [${requestId}]`, error);
    return response({ ok: false, error: '予期しないエラーが発生しました。時間をおいて再度お試しください。', requestId }, 500);
  }
});
