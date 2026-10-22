import type { TableState } from '../poker/table.ts';

/** Rejects replies from another room or older database/game revisions. */
export function canApplyRoomUpdate(
  currentRoomId: string,
  responseRoomId: string,
  expectedRoomId: string | undefined,
  currentRevision: number,
  responseRevision: number,
  currentTable: TableState | null,
  responseTable: TableState | null,
): boolean {
  if (expectedRoomId !== undefined && (expectedRoomId !== responseRoomId || expectedRoomId !== currentRoomId)) return false;
  if (currentRoomId && currentRoomId !== responseRoomId) return false;
  if (currentRoomId === responseRoomId && responseRevision < currentRevision) return false;
  if (!currentTable || !responseTable || currentRoomId !== responseRoomId) return true;
  if (responseTable.handNumber < currentTable.handNumber) return false;
  if (responseTable.handNumber === currentTable.handNumber && responseTable.version < currentTable.version) return false;
  return true;
}

/**
 * A-3: pagehide also fires on reload, tab switch and mobile backgrounding, so it must never fold a player
 * who is mid-game. Only a waiting lobby is left on a real page unload; presence and the turn timeout cover the rest.
 */
export function shouldLeaveOnPageHide(roomId: string, started: boolean, persisted: boolean): boolean {
  return Boolean(roomId) && !started && !persisted;
}

