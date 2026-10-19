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
