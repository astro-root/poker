import type { BettingAction } from '../poker/betting.ts';
import type { TableState } from '../poker/table.ts';
import { supabase } from './client.ts';

export type RoomPeer = Readonly<{ id: string; name: string; connected: boolean }>;
export type OnlineRoom = Readonly<{
  roomId: string;
  hostId: string;
  status: 'waiting' | 'playing';
  version: number;
  peers: readonly RoomPeer[];
  table: TableState | null;
  notice: string;
}>;

async function request<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error('オンライン対戦を利用するには Supabase の設定が必要です。');
  const { data, error } = await supabase.functions.invoke('rooms', { body: { action, ...args } });
  if (error) throw new Error(error.message || 'ルームサーバーに接続できませんでした。');
  if (!data?.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'リクエストを完了できませんでした。');
  return data.room as T;
}

export const createRoom = (name: string): Promise<OnlineRoom> => request('create', { name });
export const joinRoom = (roomId: string, name: string): Promise<OnlineRoom> => request('join', { roomId, name });
export const readRoom = (roomId: string): Promise<OnlineRoom> => request('state', { roomId });
export const startRoom = (roomId: string): Promise<OnlineRoom> => request('start', { roomId });
export const submitRoomAction = (roomId: string, expectedVersion: number, action: BettingAction): Promise<OnlineRoom> =>
  request('action', { roomId, expectedVersion, pokerAction: action });
export const nextRoomHand = (roomId: string, expectedVersion: number): Promise<OnlineRoom> =>
  request('next-hand', { roomId, expectedVersion });

export function createRoomId(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
