import type { BettingAction } from '../poker/betting.ts';
import {
  canApplyRoomUpdate, createRoom, joinRoom, leaveRoom, leaveRoomKeepalive, nextRoomHand, readRoom,
  rematchRoom, renameInRoom, updateRoomSettings, startRoom as startServerRoom, submitRoomAction, type OnlineRoom,
} from '../supabase/online-room.ts';
import { shouldLeaveOnPageHide } from '../supabase/room-state.ts';
import { hooks, savePlayerName, store } from './state.ts';
import { parseSettings, type RoomSettings } from '../poker/settings.ts';

const online = store.online;

export function installLifecycleHandlers(): void {
  window.addEventListener('pagehide', (event) => {
    if (shouldLeaveOnPageHide(online.roomId, online.started, event.persisted)) leaveRoomKeepalive(online.roomId);
  });
  document.addEventListener('visibilitychange', () => {
    if (online.roomId) startOnlinePolling();
  });
}

export async function closeOnlineSession(): Promise<void> {
  online.sessionEpoch++;
  if (online.pollTimer) window.clearTimeout(online.pollTimer);
  online.pollTimer = undefined;
  const roomId = online.roomId;
  if (roomId) {
    try { await leaveRoom(roomId); } catch { /* The player can still leave the page if the server is unreachable. */ }
  }
  online.roomId = '';
  online.revision = 0;
  online.pollFailures = 0;
  online.started = false;
  online.winnerId = null;
  online.finished = false;
  online.peers = [];
  online.spectators = [];
  online.role = 'player';
  online.settingsDraft = null;
  online.spectateOffer = '';
  online.names.clear();
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}

export function applyOnlineRoom(room: OnlineRoom, expectedRoomId?: string): void {
  if (!canApplyRoomUpdate(online.roomId, room.roomId, expectedRoomId, online.revision, room.revision, store.table, room.table)) return;
  online.error = '';
  online.roomId = room.roomId;
  online.revision = room.revision;
  online.host = room.hostId === store.humanId;
  online.started = room.status === 'playing';
  online.winnerId = room.winnerId;
  online.finished = room.status === 'finished';
  online.peers = [...room.peers];
  online.role = room.role ?? 'player';
  online.spectators = [...(room.spectators ?? [])];
  if (room.settingsVersion !== online.settingsVersion) online.settingsDraft = null;
  online.settings = room.settings ?? online.settings;
  online.settingsVersion = room.settingsVersion ?? 0;
  online.names = new Map([...room.peers, ...(room.spectators ?? [])].map((peer) => [peer.id, peer.name]));
  const mine = [...room.peers, ...(room.spectators ?? [])].find((peer) => peer.id === store.humanId);
  if (mine && mine.name !== store.playerName) savePlayerName(mine.name);
  if (room.table) {
    if (store.table?.handNumber !== room.table.handNumber && store.table?.hand) {
      store.humanStackAtHandStart = store.table.hand.players.find((p) => p.id === store.humanId)?.stack ?? store.humanStackAtHandStart;
      store.archivedHand = null;
      store.handHistory = [];
      store.raiseOpen = false;
    }
    store.table = room.table;
  } else if (room.status === 'waiting') store.table = null;
  store.notice = room.notice || (room.status === 'playing' ? '対戦中です。' : '参加者を待っています。');
  online.status = room.status === 'waiting' ? '招待リンクを共有して友だちを待ちます' : room.status === 'finished' ? '対戦終了' : 'オンライン対戦中';
  store.mode = room.status === 'waiting' ? 'online-lobby' : 'online-playing';
  hooks.render();
}

export async function refreshOnlineRoom(): Promise<void> {
  if (!online.roomId || online.pending || online.polling) return;
  const requested = online.roomId;
  online.polling = true;
  try {
    const result = await readRoom(requested, online.revision);
    online.pollFailures = 0;
    const hadError = Boolean(online.error);
    online.error = '';
    if ('unchanged' in result) {
      online.revision = result.revision;
      if (hadError) hooks.render();
    } else applyOnlineRoom(result, requested);
  } catch (error) {
    online.pollFailures++;
    online.error = error instanceof Error ? error.message : 'ルーム状態を取得できませんでした。';
    hooks.render();
  } finally {
    online.polling = false;
  }
}

export function startOnlinePolling(): void {
  if (online.pollTimer) window.clearTimeout(online.pollTimer);
  const schedule = (): void => {
    if (!online.roomId) return;
    // Idle screens (lobby, finished) poll slowly; a live hand polls faster so opponents' moves show up quickly.
    const live = online.started && store.table?.hand?.stage !== 'complete';
    const base = document.hidden ? 10_000 : live ? 1_200 : 3_000;
    const delay = online.pollFailures === 0 ? base : Math.min(30_000, base * 2 ** Math.min(online.pollFailures, 5));
    online.pollTimer = window.setTimeout(() => { void refreshOnlineRoom().finally(schedule); }, delay);
  };
  schedule();
}

const NOT_READY = 'オンライン対戦を利用できません。Supabase設定と匿名ログインを確認してください。';

export async function createOnlineRoom(): Promise<void> {
  const epoch = online.sessionEpoch;
  try {
    if (!store.guestOnlineReady) throw new Error(NOT_READY);
    const room = await createRoom(store.playerName);
    if (epoch !== online.sessionEpoch) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#room=${room.roomId}`);
    store.mode = 'online-lobby';
    applyOnlineRoom(room);
    startOnlinePolling();
  } catch (error) {
    online.error = error instanceof Error ? error.message : 'ルームを作成できませんでした。';
    hooks.render();
  }
}

export async function joinOnlineRoom(roomId: string, spectate = false): Promise<void> {
  if (!/^[a-f0-9]{36}$/u.test(roomId)) { online.error = '招待リンクが正しくありません。'; hooks.render(); return; }
  const epoch = online.sessionEpoch;
  try {
    if (!store.guestOnlineReady) throw new Error(NOT_READY);
    const room = await joinRoom(roomId, store.playerName, spectate);
    if (epoch !== online.sessionEpoch) return;
    store.mode = room.status === 'playing' ? 'online-playing' : 'online-lobby';
    applyOnlineRoom(room);
    startOnlinePolling();
  } catch (error) {
    online.error = error instanceof Error ? error.message : 'ルームに参加できませんでした。';
    // A started game cannot be joined as a player, but it can be watched.
    online.spectateOffer = /すでに始まって/u.test(online.error) ? roomId : '';
    hooks.render();
  }
}

export function startOnlineGame(): void {
  if (!online.host || online.peers.filter((peer) => peer.connected).length < 2) {
    online.error = '友だちが参加するまで待ってください。'; hooks.render(); return;
  }
  const roomId = online.roomId;
  void startServerRoom(roomId).then((room) => applyOnlineRoom(room, roomId)).catch((error: unknown) => {
    online.error = error instanceof Error ? error.message : '対戦を開始できませんでした。';
    hooks.render();
  });
}

function withPending<T>(work: () => Promise<T>, onError: string): void {
  if (online.pending) return;
  online.pending = true;
  hooks.render();
  void work().catch((error: unknown) => {
    online.error = error instanceof Error ? error.message : onError;
    hooks.render();
    void refreshOnlineRoom();
  }).finally(() => { online.pending = false; hooks.render(); });
}

export function submitOnlineAction(action: BettingAction): void {
  const table = store.table;
  if (!table) return;
  const roomId = online.roomId;
  store.notice = '操作を送信しています…';
  withPending(() => submitRoomAction(roomId, table.version, action).then((room) => applyOnlineRoom(room, roomId)), '操作を反映できませんでした。');
}

export function requestNextOnlineHand(): void {
  const table = store.table;
  if (!table) return;
  const roomId = online.roomId;
  withPending(() => nextRoomHand(roomId, table.version).then((room) => applyOnlineRoom(room, roomId)), '次のハンドを開始できませんでした。');
}

export function requestRematch(): void {
  const roomId = online.roomId;
  withPending(() => rematchRoom(roomId).then((room) => applyOnlineRoom(room, roomId)), 'リマッチを開始できませんでした。');
}

export function saveRoomSettings(draft: RoomSettings): void {
  const checked = parseSettings(draft);
  if (!checked.ok) { online.error = checked.error; hooks.render(); return; }
  const roomId = online.roomId;
  withPending(() => updateRoomSettings(roomId, checked.settings, online.settingsVersion).then((room) => applyOnlineRoom(room, roomId)), '設定を保存できませんでした。');
}

/** Changes only this user's own display name; the server decides uniqueness and validity. */
export function renameSelf(raw: string): void {
  const roomId = online.roomId;
  if (!roomId) { savePlayerName(raw); hooks.render(); return; }
  withPending(() => renameInRoom(roomId, raw).then((room) => applyOnlineRoom(room, roomId)), '名前を変更できませんでした。');
}
