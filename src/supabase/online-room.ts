import type { BettingAction } from '../poker/betting.ts';
import type { TableState } from '../poker/table.ts';
import type { RoomSettings } from '../poker/settings.ts';
export { canApplyRoomUpdate } from './room-state.ts';
import { getFunctionErrorMessage } from './function-error.ts';
import { getCachedAccessToken, supabase, supabasePublishableKey, supabaseUrl } from './client.ts';

export type RoomPeer = Readonly<{ id: string; name: string; connected: boolean }>;
export type OnlineRoom = Readonly<{
  roomId: string;
  hostId: string;
  status: 'waiting' | 'playing' | 'finished';
  revision: number;
  winnerId: string | null;
  version: number;
  peers: readonly RoomPeer[];
  /** `spectator` viewers can read the table but never act and never receive hole cards. */
  code: string | null;
  chat: readonly ChatMessage[];
  role: 'player' | 'spectator';
  spectators: readonly RoomPeer[];
  settings: RoomSettings;
  settingsVersion: number;
  table: TableState | null;
  notice: string;
}>;
export type UnchangedRoom = Readonly<{ unchanged: true; revision: number }>;

async function request<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error('オンライン対戦を利用するには Supabase の設定が必要です。');
  const { data, error } = await supabase.functions.invoke('rooms', { body: { action, ...args } });
  if (error) throw new Error(await getFunctionErrorMessage(error));
  if (!data?.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'リクエストを完了できませんでした。');
  if (data.unchanged === true) return data as T;
  return data.room as T;
}

export type ChatMessage = Readonly<{ id: number; from: string; name: string; kind: 'text' | 'emoji'; text: string; at: number }>;
export const CHAT_EMOJI = ['👍', '😂', '😮', '😭', '🔥', '👏', '🤔', '🍀', '😎', '💀'] as const;
export const createRoom = (name: string, settings?: RoomSettings): Promise<OnlineRoom> => request('create', { name, ...(settings ? { settings } : {}) });
export const joinRoomByCode = (code: string, name: string): Promise<OnlineRoom> => request('join', { code, name });
export const kickFromRoom = (roomId: string, targetId: string): Promise<OnlineRoom> => request('kick', { roomId, targetId });
export const sendRoomChat = (roomId: string, kind: 'text' | 'emoji', text: string): Promise<OnlineRoom> => request('chat', { roomId, kind, text });
export const joinRoom = (roomId: string, name: string, spectate = false): Promise<OnlineRoom> => request('join', { roomId, name, ...(spectate ? { spectate: true } : {}) });
export const updateRoomSettings = (roomId: string, settings: RoomSettings, expectedSettingsVersion: number): Promise<OnlineRoom> =>
  request('settings', { roomId, settings, expectedSettingsVersion });
export const renameInRoom = (roomId: string, name: string): Promise<OnlineRoom> => request('rename', { roomId, name });
export const readRoom = (roomId: string, sinceRevision?: number): Promise<OnlineRoom | UnchangedRoom> =>
  request('state', { roomId, ...(sinceRevision === undefined ? {} : { sinceRevision }) });
export const startRoom = (roomId: string): Promise<OnlineRoom> => request('start', { roomId });
export const submitRoomAction = (roomId: string, expectedVersion: number, action: BettingAction): Promise<OnlineRoom> =>
  request('action', { roomId, expectedVersion, pokerAction: action });
export const nextRoomHand = (roomId: string, expectedVersion: number): Promise<OnlineRoom> =>
  request('next-hand', { roomId, expectedVersion });
export const rematchRoom = (roomId: string): Promise<OnlineRoom> => request('rematch', { roomId });
export const leaveRoom = (roomId: string): Promise<OnlineRoom | null> => request('leave', { roomId });

export function leaveRoomKeepalive(roomId: string): void {
  const accessToken = getCachedAccessToken();
  if (!supabase || !supabaseUrl || !supabasePublishableKey || !accessToken) return;
  void fetch(`${supabaseUrl}/functions/v1/rooms`, {
    method: 'POST',
    headers: { apikey: supabasePublishableKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'leave', roomId }),
    keepalive: true,
  }).catch(() => undefined);
}
