import { applyTableAction, createTable, isGameOver, startNextHand, type TableState } from '../../../src/poker/table.ts';
import { getLegalActions, type BettingAction } from '../../../src/poker/betting.ts';
import { foldHandPlayer } from '../../../src/poker/hand.ts';
import { uniqueDisplayName, validateDisplayName } from '../../../src/poker/names.ts';
import { parseSettings, settingsOrDefault, type RoomSettings } from '../../../src/poker/settings.ts';

// SECURITY: this function reads the JWT payload without verifying its signature. That is only safe
// because supabase/config.toml sets `verify_jwt = true`, so the platform rejects forged tokens first.
// NEVER disable verify_jwt for this function. If you must, implement signature verification here first.

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

type Member = Readonly<{ id: string; name: string; lastSeenAt?: number; sittingOut?: boolean }>;
type RoomTableState = TableState & Readonly<{ turnDeadline?: number | null }>;
type RoomState = Readonly<{
  /** Seated players. Only these can act, start, rematch or change settings. */
  members: readonly Member[];
  /** Read-only viewers. They never receive hole cards and are never dealt in. */
  spectators?: readonly Member[];
  settings?: RoomSettings;
  /** Incremented on every settings change so a stale form cannot overwrite newer values. */
  settingsVersion?: number;
  notice: string;
  table: RoomTableState | null;
  winnerId?: string;
}>;
type RoomStatus = 'waiting' | 'playing' | 'finished';
type RoomRow = Readonly<{ id: string; host_user_id: string; status: RoomStatus; revision: number; state: RoomState }>;

const TURN_TIMEOUT_MS = 45_000;
const PRESENCE_TIMEOUT_MS = 15_000;
/** Presence is rewritten at most this often so polling does not rewrite the whole game state. */
const TOUCH_INTERVAL_MS = 5_000;
/** In a waiting room, members unseen for this long are dropped (the host is handed over, not dropped blindly). */
const WAITING_ABSENT_MS = 60_000;
/** A player away this long is "retired": chips stay seated but the table no longer waits for them. */
const RETIRE_AFTER_MS = 10 * 60_000;
const MAX_MEMBERS = 6;
const MAX_SPECTATORS = 20;
const SPECTATOR_ABSENT_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type RoomErrorCode =
  | 'STALE_VERSION' | 'REVISION_CONFLICT' | 'ROOM_FULL' | 'GAME_STARTED' | 'NOT_ENOUGH_PLAYERS'
  | 'NOT_YOUR_TURN' | 'NOT_A_MEMBER' | 'NOT_HOST' | 'BAD_REQUEST' | 'ROOM_NOT_FOUND' | 'RATE_LIMITED' | 'UNAUTHORIZED' | 'SPECTATOR_FORBIDDEN' | 'STALE_SETTINGS' | 'BAD_SETTINGS';

class RoomError extends Error {
  readonly status: number;
  readonly userMessage: string;
  readonly code: RoomErrorCode | undefined;

  constructor(status: number, userMessage: string, code?: RoomErrorCode) {
    super(userMessage);
    this.name = 'RoomError';
    this.status = status;
    this.userMessage = userMessage;
    this.code = code;
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

function cleanName(value: unknown, taken: readonly string[] = []): string {
  const checked = validateDisplayName(value, 'プレイヤー');
  if (!checked.ok) {
    throw new RoomError(400, checked.reason === 'too-long'
      ? '名前は20文字以内で入力してください。'
      : '名前に使用できない文字が含まれています。', 'BAD_REQUEST');
  }
  return uniqueDisplayName(checked.name, taken);
}

function parseAction(value: unknown): BettingAction {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new RoomError(400, 'アクションの形式が正しくありません。', 'BAD_REQUEST');
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
      throw new RoomError(400, 'アクションの形式が正しくありません。', 'BAD_REQUEST');
  }
}

function parseExpectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value)) throw new RoomError(400, '画面の状態が正しくありません。更新してからお試しください。');
  return value as number;
}

function verifiedUserId(request: Request): string {
  const authorization = request.headers.get('Authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/iu, '');
  const payload = token.split('.')[1];
  if (!payload) throw new RoomError(401, 'ログイン状態を確認できません。', 'UNAUTHORIZED');
  try {
    const base64 = payload.replace(/-/gu, '+').replace(/_/gu, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const decoded = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(decoded)) as { sub?: unknown; role?: unknown; exp?: unknown };
    if (typeof claims.sub !== 'string' || !UUID.test(claims.sub)) throw new Error('JWT subject is not a UUID');
    if (claims.role !== 'authenticated') throw new Error('JWT role is not authenticated');
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp * 1_000 <= Date.now()) throw new Error('JWT expired');
    return claims.sub;
  } catch {
    throw new RoomError(401, 'ログイン状態を確認できません。', 'UNAUTHORIZED');
  }
}

type Limit = Readonly<{ bucket: string; limit: number; windowMs: number }>;
/**
 * Per-action budgets, keyed by the authenticated user id (not the IP, so shared mobile networks are not
 * penalised). Mutations are counted in the database so the limit holds across Edge Function instances.
 */
const LIMITS: Readonly<Record<string, Limit>> = {
  create: { bucket: 'create', limit: 5, windowMs: 60_000 },
  join: { bucket: 'join', limit: 20, windowMs: 60_000 },
  rename: { bucket: 'name', limit: 5, windowMs: 10_000 },
  settings: { bucket: 'settings', limit: 10, windowMs: 5_000 },
  start: { bucket: 'game', limit: 10, windowMs: 1_000 },
  action: { bucket: 'game', limit: 10, windowMs: 1_000 },
  'next-hand': { bucket: 'game', limit: 10, windowMs: 1_000 },
  rematch: { bucket: 'rematch', limit: 5, windowMs: 10_000 },
};
/** State polling is the hottest path, so it is limited in memory (best effort, per instance) to avoid a database write per poll. */
const STATE_LIMIT = { limit: 10, windowMs: 5_000 };
const stateWindows = new Map<string, { startedAt: number; count: number }>();

function enforceStateRateLimit(userId: string, now: number): void {
  const entry = stateWindows.get(userId);
  if (!entry || now - entry.startedAt >= STATE_LIMIT.windowMs) {
    if (stateWindows.size > 5_000) stateWindows.clear();
    stateWindows.set(userId, { startedAt: now, count: 1 });
    return;
  }
  entry.count++;
  if (entry.count > STATE_LIMIT.limit) throw new RoomError(429, '更新の頻度が高すぎます。少し待ってからもう一度お試しください。', 'RATE_LIMITED');
}

async function enforceUserRateLimit(url: string, serviceKey: string, userId: string, now: number, limit: Limit): Promise<void> {
  const allowed = await supabaseRequest<boolean>(url, serviceKey, '/rest/v1/rpc/consume_room_rate_limit', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: userId, p_bucket: limit.bucket, p_now: new Date(now).toISOString(), p_limit: limit.limit, p_window_ms: limit.windowMs }),
  });
  if (!allowed) throw new RoomError(429, '操作が多すぎます。少し待ってからもう一度お試しください。', 'RATE_LIMITED');
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

async function saveRoom(url: string, serviceKey: string, row: RoomRow, state: RoomState, status = row.status, hostId?: string): Promise<RoomRow | null> {
  const rows = await supabaseRequest<RoomRow[]>(url, serviceKey,
    `/rest/v1/poker_rooms?id=eq.${encodeURIComponent(row.id)}&revision=eq.${row.revision}&select=*`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ state, status, ...(hostId ? { host_user_id: hostId } : {}), revision: row.revision + 1, updated_at: new Date().toISOString() }),
    });
  return rows[0] ?? null;
}

async function touchRoom(url: string, serviceKey: string, row: RoomRow, state: RoomState): Promise<RoomRow | null> {
  const rows = await supabaseRequest<RoomRow[]>(url, serviceKey,
    `/rest/v1/poker_rooms?id=eq.${encodeURIComponent(row.id)}&revision=eq.${row.revision}&select=*`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ state, updated_at: new Date().toISOString() }),
    });
  return rows[0] ?? null;
}

async function cleanupExpiredRooms(url: string, serviceKey: string, now: number): Promise<void> {
  const finishedCutoff = encodeURIComponent(new Date(now - 60 * 60 * 1_000).toISOString());
  const roomCutoff = encodeURIComponent(new Date(now - 24 * 60 * 60 * 1_000).toISOString());
  await supabaseRequest<unknown>(url, serviceKey,
    `/rest/v1/poker_rooms?status=eq.finished&updated_at=lt.${finishedCutoff}`, { method: 'DELETE' });
  await supabaseRequest<unknown>(url, serviceKey,
    `/rest/v1/poker_rooms?status=neq.finished&updated_at=lt.${roomCutoff}`, { method: 'DELETE' });
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

/** A failure while resolving a timeout must never lock players out of state/leave (A-9). */
function resolveExpiredTurnSafely(state: RoomState, now: number): RoomState {
  try { return resolveExpiredTurn(state, now); } catch (error) {
    console.error('resolveExpiredTurn failed; continuing without timeout handling', error);
    return state;
  }
}

function finishIfNecessary(state: RoomState, status: RoomStatus): { state: RoomState; status: RoomStatus } {
  const table = state.table;
  if (status !== 'playing' || !table || !isGameOver(table)) return { state, status };
  const ranked = table.seats.filter((seat) => seat.stack > 0).sort((a, b) => b.stack - a.stack);
  const top = ranked[0];
  const nameOf = (id: string | undefined): string => state.members.find((member) => member.id === id)?.name ?? 'プレイヤー';
  if (!top) return { state: { ...state, winnerId: undefined, notice: '対戦が終了しました。' }, status: 'finished' };
  const tied = ranked.filter((seat) => seat.stack === top.stack);
  if (tied.length > 1) {
    return { state: { ...state, winnerId: undefined, notice: `規定ハンド数が終了しました。${tied.map((seat) => nameOf(seat.id)).join('・')}の同点です。` }, status: 'finished' };
  }
  const limitReached = table.maxHands !== null && table.maxHands !== undefined && table.handNumber >= table.maxHands && ranked.length > 1;
  return { state: { ...state, winnerId: top.id, notice: limitReached ? `規定ハンド数が終了しました。${nameOf(top.id)}がチップ首位で優勝です。` : `${nameOf(top.id)}の優勝です。` }, status: 'finished' };
}

function fail(status: number, error: string, code?: RoomErrorCode): Response {
  return response({ ok: false, error, ...(code ? { code } : {}) }, status);
}

/** Drops absent members from a waiting room; hands the host role to a present member if the host is gone. */
function pruneWaitingRoom(state: RoomState, hostId: string, now: number): { state: RoomState; hostId: string; changed: boolean } {
  const absent = (member: Member): boolean => !Number.isSafeInteger(member.lastSeenAt) || now - (member.lastSeenAt as number) >= WAITING_ABSENT_MS;
  const host = state.members.find((member) => member.id === hostId);
  const present = state.members.filter((member) => !absent(member));
  let nextHost = hostId;
  if ((!host || absent(host)) && present.length > 0) nextHost = present[0]!.id;
  const keep = state.members.filter((member) => member.id === nextHost || !absent(member));
  if (keep.length === state.members.length && nextHost === hostId) return { state, hostId, changed: false };
  return { state: { ...state, members: keep }, hostId: nextHost, changed: true };
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
    revision: row.revision,
    winnerId: room.winnerId ?? null,
    version: row.state.table?.version ?? 0,
    peers: room.members.map((member) => ({ id: member.id, name: member.name, connected: isConnected(member, now) })),
    role: room.members.some((member) => member.id === viewerId) ? 'player' : 'spectator',
    spectators: (room.spectators ?? []).map((member) => ({ id: member.id, name: member.name, connected: isConnected(member, now) })),
    settings: settingsOrDefault(room.settings),
    settingsVersion: room.settingsVersion ?? 0,
    table,
    notice: room.notice,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return response({ ok: false, error: 'POST only' }, 405);
  try {
    const userId = verifiedUserId(request);
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    let body: any;
    try { body = await request.json(); } catch {
      throw new RoomError(400, 'リクエストの形式が正しくありません。');
    }
    const action = body?.action;
    const now = Date.now();

    if (action === 'state') enforceStateRateLimit(userId, now);
    else if (typeof action === 'string' && Object.hasOwn(LIMITS, action)) await enforceUserRateLimit(url, serviceKey, userId, now, LIMITS[action]!);

    if (action === 'create') {
      try { await cleanupExpiredRooms(url, serviceKey, now); } catch (error) {
        console.error('room ttl cleanup failed', error);
      }
      const openRooms = await supabaseRequest<Array<{ id: string }>>(url, serviceKey,
        `/rest/v1/poker_rooms?host_user_id=eq.${encodeURIComponent(userId)}&status=neq.finished&select=id`);
      if (openRooms.length >= 3) throw new RoomError(429, '未終了のルームは1人3件まで作成できます。', 'RATE_LIMITED');
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
    if (!/^[a-f0-9]{36}$/u.test(roomId)) return fail(400, '招待リンクが正しくありません。', 'BAD_REQUEST');
    const found = await getRoom(url, serviceKey, roomId);
    if (!found) return fail(404, 'ルームが見つかりません。ホストに新しい招待リンクを頼んでください。', 'ROOM_NOT_FOUND');
    let row = found as RoomRow;

    const isMember = row.state.members.some((member) => member.id === userId);
    const isSpectator = (row.state.spectators ?? []).some((member) => member.id === userId);
    const wantsToSpectate = action === 'join' && body.spectate === true && !isMember;
    // Spectators may only read state, rename themselves, rejoin, or leave. Everything else is a player action.
    if (action !== 'join' && !isMember) {
      if (isSpectator && !['state', 'leave', 'rename'].includes(action)) return fail(403, '観戦中はこの操作はできません。', 'SPECTATOR_FORBIDDEN');
      if (!isSpectator) return fail(403, 'このルームの参加者ではありません。', 'NOT_A_MEMBER');
    }
    if (action === 'join' && !isMember && !wantsToSpectate && row.status !== 'waiting') return fail(409, 'この対戦はすでに始まっています。観戦として参加できます。', 'GAME_STARTED');

    const timedState = resolveExpiredTurnSafely(row.state, now);
    const timedGame = finishIfNecessary(timedState, row.status);
    if (timedState !== row.state || timedGame.status !== row.status) {
      const saved = await saveRoom(url, serviceKey, row, timedGame.state, timedGame.status);
      if (!saved) return fail(409, 'ルームの状態が更新されました。もう一度お試しください。', 'REVISION_CONFLICT');
      row = saved;
    }

    // The caller is evidently present: refresh them in memory first so pruning never removes the requester.
    const markPresent = (state: RoomState): RoomState => ({
      ...state,
      members: state.members.map((member) => member.id === userId ? { ...member, lastSeenAt: now } : member),
      ...(state.spectators ? { spectators: state.spectators.map((member) => member.id === userId ? { ...member, lastSeenAt: now } : member) } : {}),
    });

    if (wantsToSpectate) {
      const live = (row.state.spectators ?? []).filter((member) => member.id === userId || now - (member.lastSeenAt ?? 0) < SPECTATOR_ABSENT_MS);
      let spectators: Member[];
      if (live.some((member) => member.id === userId)) spectators = live.map((member) => member.id === userId ? { ...member, lastSeenAt: now } : member);
      else {
        if (live.length >= MAX_SPECTATORS) return fail(409, '観戦席が満員です。', 'ROOM_FULL');
        const name = cleanName(body.name, [...row.state.members, ...live].map((entry) => entry.name));
        spectators = [...live, { id: userId, name, lastSeenAt: now }];
      }
      const saved = await saveRoom(url, serviceKey, row, { ...row.state, spectators });
      if (!saved) return fail(409, 'ルームが更新されました。もう一度お試しください。', 'REVISION_CONFLICT');
      return response({ ok: true, room: publicRoom(saved, userId, now) });
    }

    if (action === 'join') {
      const base = row.state.members.some((member) => member.id === userId) ? markPresent(row.state) : row.state;
      const pruned = row.status === 'waiting' ? pruneWaitingRoom(base, row.host_user_id, now) : { state: base, hostId: row.host_user_id, changed: false };
      const member = pruned.state.members.find((entry) => entry.id === userId);
      let state: RoomState;
      if (!member) {
        if (pruned.state.members.length >= MAX_MEMBERS) return fail(409, 'このルームは満員です（最大6人）。', 'ROOM_FULL');
        const name = cleanName(body.name, [...pruned.state.members, ...(pruned.state.spectators ?? [])].filter((entry) => entry.id !== userId).map((entry) => entry.name));
        state = { ...pruned.state, members: [...pruned.state.members, { id: userId, name, lastSeenAt: now }],
          // A spectator who takes a seat stops being a spectator: the two roles never overlap.
          ...(pruned.state.spectators ? { spectators: pruned.state.spectators.filter((entry) => entry.id !== userId) } : {}),
          notice: `${name}が参加しました。` };
      } else {
        state = { ...pruned.state, members: pruned.state.members.map((entry) => entry.id === userId ? { ...entry, lastSeenAt: now, sittingOut: false } : entry) };
      }
      const data = await saveRoom(url, serviceKey, row, state, row.status, pruned.hostId !== row.host_user_id ? pruned.hostId : undefined);
      if (!data) return fail(409, 'ルームが更新されました。もう一度参加してください。', 'REVISION_CONFLICT');
      return response({ ok: true, room: publicRoom(data as RoomRow, userId, now) });
    }

    if (action === 'rename') {
      if (typeof body.name !== 'string' || body.name.trim() === '') throw new RoomError(400, '名前を入力してください。', 'BAD_REQUEST');
      const everyone = [...row.state.members, ...(row.state.spectators ?? [])];
      const self = everyone.find((member) => member.id === userId)!;
      const name = cleanName(body.name, everyone.filter((member) => member.id !== userId).map((member) => member.name));
      if (name === self.name) return response({ ok: true, room: publicRoom(row, userId, now) });
      // Only the display name changes: ids, seats, chips, cards and host rights are untouched.
      const renamed = (list: readonly Member[]): Member[] => list.map((member) => member.id === userId ? { ...member, name, lastSeenAt: now } : member);
      const saved = await saveRoom(url, serviceKey, row, { ...row.state, members: renamed(row.state.members),
        ...(row.state.spectators ? { spectators: renamed(row.state.spectators) } : {}), notice: `${self.name}が名前を${name}に変更しました。` });
      if (!saved) return fail(409, 'ルームの状態が更新されました。もう一度お試しください。', 'REVISION_CONFLICT');
      return response({ ok: true, room: publicRoom(saved, userId, now) });
    }

    if (action === 'leave' && !isMember) {
      const saved = await saveRoom(url, serviceKey, row, { ...row.state, spectators: (row.state.spectators ?? []).filter((member) => member.id !== userId) });
      if (!saved) return fail(409, 'ルームの状態が更新されました。もう一度お試しください。', 'REVISION_CONFLICT');
      return response({ ok: true, room: null });
    }

    if (action === 'leave') {
      const leaver = row.state.members.find((member) => member.id === userId)!;
      // While playing, a leaver keeps their seat and chips (sitting out). Only a waiting room removes them.
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
        if (!deleted.length) return fail(409, 'ルームの状態が更新されました。もう一度お試しください。', 'REVISION_CONFLICT');
        return response({ ok: true, room: null });
      }
      let table = row.state.table;
      if (row.status === 'playing' && table?.hand?.bettingRound) {
        try {
          const folded = foldHandPlayer(table.hand, userId);
          table = withTurnDeadline({ ...table, hand: folded }, now);
        } catch (error) {
          console.error('fold on leave failed; the player is still marked as away', error);
        }
      }
      const finishedGame = finishIfNecessary({ ...row.state, members, table }, row.status);
      const nextHost = row.host_user_id === userId
        ? members.find((member) => isConnected(member, now))?.id ?? row.host_user_id
        : row.host_user_id;
      const state: RoomState = finishedGame.status === 'finished'
        ? finishedGame.state
        : { ...finishedGame.state, notice: `${leaver.name}が退出しました。` };
      const rows = await supabaseRequest<RoomRow[]>(url, serviceKey,
        `/rest/v1/poker_rooms?id=eq.${encodeURIComponent(row.id)}&revision=eq.${row.revision}&select=*`, {
          method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ state, status: finishedGame.status, host_user_id: nextHost,
            revision: row.revision + 1, updated_at: new Date().toISOString() }),
        });
      if (!rows.length) return fail(409, 'ルームの状態が更新されました。もう一度お試しください。', 'REVISION_CONFLICT');
      return response({ ok: true, room: publicRoom(rows[0], userId, now) });
    }

    const requesterBefore = (row.state.members.find((member) => member.id === userId) ?? (row.state.spectators ?? []).find((member) => member.id === userId))!;
    row = { ...row, state: markPresent(row.state) };
    if (row.status === 'waiting') {
      const pruned = pruneWaitingRoom(row.state, row.host_user_id, now);
      if (pruned.changed) {
        const saved = await saveRoom(url, serviceKey, row, pruned.state, row.status, pruned.hostId !== row.host_user_id ? pruned.hostId : undefined);
        if (!saved) return fail(409, 'ルームの状態が更新されました。もう一度お試しください。', 'REVISION_CONFLICT');
        row = saved;
      }
    }

    if (action === 'state') {
      const unchangedRequest = Number.isSafeInteger(body.sinceRevision) && body.sinceRevision === row.revision;
      const lastSeen = Number.isSafeInteger(requesterBefore.lastSeenAt) ? requesterBefore.lastSeenAt as number : -Infinity;
      let current = row;
      if (isMember && requesterBefore.sittingOut) {
        // Someone who is polling is back: bring them to the next hand (this is a visible change, so bump the revision).
        const saved = await saveRoom(url, serviceKey, row, { ...row.state, members: row.state.members.map((member) => member.id === userId ? { ...member, sittingOut: false } : member) });
        if (!saved) return fail(409, 'ルームの状態が更新されました。もう一度お試しください。', 'REVISION_CONFLICT');
        current = saved;
      } else if (now - lastSeen >= TOUCH_INTERVAL_MS) {
        // Presence only: rewritten at most every few seconds; a lost race is harmless.
        current = (await touchRoom(url, serviceKey, row, row.state)) ?? (await getRoom(url, serviceKey, row.id)) ?? row;
      }
      if (unchangedRequest && current.revision === body.sinceRevision) return response({ ok: true, unchanged: true, revision: current.revision });
      return response({ ok: true, room: publicRoom(current, userId, now) });
    }

    let nextState: RoomState;
    let status = row.status;
    if (action === 'settings') {
      if (row.host_user_id !== userId) return fail(403, '設定を変更できるのはホストだけです。', 'NOT_HOST');
      if (row.status !== 'waiting') return fail(409, '対戦開始後は設定を変更できません。', 'GAME_STARTED');
      const parsed = parseSettings(body.settings);
      if (!parsed.ok) return fail(400, parsed.error, 'BAD_SETTINGS');
      const currentVersion = row.state.settingsVersion ?? 0;
      if (!Number.isSafeInteger(body.expectedSettingsVersion) || body.expectedSettingsVersion !== currentVersion) {
        return fail(409, '設定が他の操作で更新されました。最新の設定を確認してください。', 'STALE_SETTINGS');
      }
      nextState = { ...row.state, settings: parsed.settings, settingsVersion: currentVersion + 1, notice: 'ホストが設定を変更しました。' };
    } else if (action === 'start') {
      if (row.host_user_id !== userId) return fail(403, '対戦を開始できるのはホストです。', 'NOT_HOST');
      if (row.status !== 'waiting') return fail(409, '2人以上が参加してから開始してください。', 'GAME_STARTED');
      const present = row.state.members.filter((member) => isConnected(member, now));
      if (present.length < 2) return fail(409, '在席中のプレイヤーが2人以上必要です。', 'NOT_ENOUGH_PLAYERS');
      // Absent members keep a seat (and can return with `join`) but are not dealt into the first hand.
      const away = new Set(row.state.members.filter((member) => !isConnected(member, now)).map((member) => member.id));
      const settings = settingsOrDefault(row.state.settings);
      const base = createTable(row.state.members.map((member) => ({ id: member.id, stack: settings.startingStack })), settings.smallBlind, settings.bigBlind,
        { ante: settings.ante, maxHands: settings.maxHands, escalateBlinds: settings.escalateBlinds });
      const table = withTurnDeadline(startNextHand(base, away), now);
      nextState = {
        ...row.state,
        members: row.state.members.map((member) => away.has(member.id) ? { ...member, sittingOut: true } : member),
        table,
        notice: away.size > 0 ? 'ホストが対戦を開始しました。離席中の人は戻ると次のハンドから参加します。' : 'ホストが対戦を開始しました。',
      };
      status = 'playing';
    } else if (action === 'action') {
      const table = row.state.table;
      if (row.status !== 'playing' || !table?.hand?.bettingRound) return fail(409, '現在は操作できません。');
      if (table.hand.bettingRound.actorId !== userId) return fail(409, 'まだあなたの番ではありません。', 'NOT_YOUR_TURN');
      const pokerAction = parseAction(body.pokerAction);
      const expectedVersion = parseExpectedVersion(body.expectedVersion);
      if (expectedVersion !== table.version) throw new RoomError(409, '画面が更新されています。状態を更新してください。', 'STALE_VERSION');
      let nextTable: TableState;
      try { nextTable = applyTableAction(table, expectedVersion, userId, pokerAction); } catch {
        throw new RoomError(422, 'そのアクションは実行できません。現在の状態を確認してください。');
      }
      nextTable = withTurnDeadline(nextTable, now);
      const actionState: RoomState = { ...row.state, table: nextTable, winnerId: undefined,
        notice: `${row.state.members.find((member) => member.id === userId)?.name ?? 'プレイヤー'}がアクションしました。` };
      const finishedGame = finishIfNecessary(actionState, row.status);
      nextState = finishedGame.state;
      status = finishedGame.status;
    } else if (action === 'rematch') {
      // Several players tapping at once: the first wins the revision race, the rest see the finished reset and get the same room back.
      if (row.status === 'waiting' && row.state.table === null) return response({ ok: true, room: publicRoom(row, userId, now) });
      if (row.status !== 'finished') return fail(409, '終了した対戦でのみリマッチできます。');
      const requester = row.state.members.find((member) => member.id === userId);
      if (!requester || !isConnected(requester, now)) return fail(403, '在席中のプレイヤーのみリマッチできます。', 'NOT_A_MEMBER');
      nextState = {
        ...row.state,
        members: row.state.members.map((member) => ({ ...member, sittingOut: false })),
        table: null,
        winnerId: undefined,
        notice: 'リマッチできます。参加者がそろったら対戦を開始してください。',
      };
      status = 'waiting';
    } else if (action === 'next-hand') {
      if (row.status !== 'playing' || !row.state.table) return fail(409, '現在は次のハンドを開始できません。');
      const requester = row.state.members.find((member) => member.id === userId);
      if (!requester || !isConnected(requester, now)) return fail(403, '在席中のプレイヤーのみ次のハンドを開始できます。', 'NOT_A_MEMBER');
      const table = row.state.table;
      const expectedVersion = parseExpectedVersion(body.expectedVersion);
      if (expectedVersion !== table.version) return fail(409, '画面が更新されています。状態を更新してください。', 'STALE_VERSION');
      // Players whose tab went quiet are seated out so the table is not stalled by turn timeouts every hand.
      const away = new Set(row.state.members.filter((member) => !isConnected(member, now)).map((member) => member.id));
      const members = row.state.members.map((member) => away.has(member.id) ? { ...member, sittingOut: true } : member);
      let nextTable: TableState;
      try { nextTable = startNextHand(table, away); } catch {
        // Everyone else is away. If they have been gone a long time, the remaining player wins by retirement.
        const others = table.seats.filter((seat) => seat.stack > 0 && seat.id !== userId);
        const retired = others.length > 0 && others.every((seat) => {
          const member = row.state.members.find((entry) => entry.id === seat.id);
          return member?.sittingOut === true || !Number.isSafeInteger(member?.lastSeenAt) || now - (member!.lastSeenAt as number) >= RETIRE_AFTER_MS;
        });
        if (retired) {
          const name = requester.name;
          const finishedState: RoomState = { ...row.state, members, winnerId: userId, notice: `${name}の優勝です（他のプレイヤーが退席しました）。` };
          const savedFinish = await saveRoom(url, serviceKey, row, finishedState, 'finished');
          if (!savedFinish) return fail(409, '同時に操作がありました。最新の状態に更新してください。', 'REVISION_CONFLICT');
          return response({ ok: true, room: publicRoom(savedFinish, userId, now) });
        }
        throw new RoomError(409, '次のハンドを開始できません。他のプレイヤーが戻るまでお待ちください。', 'NOT_ENOUGH_PLAYERS');
      }
      nextTable = withTurnDeadline(nextTable, now);
      nextState = { ...row.state, members, table: nextTable, notice: '次のハンドが始まりました。' };
    } else return fail(400, '操作が正しくありません。', 'BAD_REQUEST');

    const updated = await saveRoom(url, serviceKey, row, nextState, status);
    if (!updated && action === 'rematch') {
      // Lost the race to another player's rematch tap: if the room is already reset, return it instead of erroring.
      const latest = await getRoom(url, serviceKey, row.id);
      if (latest && latest.status === 'waiting' && latest.state.table === null) return response({ ok: true, room: publicRoom(latest, userId, now) });
    }
    if (!updated) return fail(409, '同時に操作がありました。最新の状態に更新してください。', 'REVISION_CONFLICT');
    return response({ ok: true, room: publicRoom(updated as RoomRow, userId, now) });
  } catch (error) {
    if (error instanceof RoomError) return response({ ok: false, error: error.userMessage, ...(error.code ? { code: error.code } : {}) }, error.status);
    const requestId = crypto.randomUUID();
    console.error(`rooms function error [${requestId}]`, error);
    return response({ ok: false, error: '予期しないエラーが発生しました。時間をおいて再度お試しください。', requestId }, 500);
  }
});
