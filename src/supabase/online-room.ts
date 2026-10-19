import type { BettingAction } from '../poker/betting.ts';
import type { TableState } from '../poker/table.ts';
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
  table: TableState | null;
  notice: string;
}>;
export type UnchangedRoom = Readonly<{ unchanged: true; revision: number }>;

async function request<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error('オンライン対戦を利用するには Supabase の設定が必要です。');
  const { data, error } = await supabase.functions.invoke('rooms', { body: { action, ...args } });
  if (error) throw new Error(error.message || 'ルームサーバーに接続できませんでした。');
  if (!data?.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'リクエストを完了できませんでした。');
  if (data.unchanged === true) return data as T;
  return data.room as T;
}

export const createRoom = (name: string): Promise<OnlineRoom> => request('create', { name });
export const joinRoom = (roomId: string, name: string): Promise<OnlineRoom> => request('join', { roomId, name });
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

export function createRoomId(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
