import { AI_LEVELS, type AiLevel } from '../poker/ai.ts';
import { cleanNameInput } from '../poker/names.ts';
import { getHandPot } from '../poker/hand.ts';
import type { BettingAction } from '../poker/betting.ts';
import type { TableState } from '../poker/table.ts';
import type { EquityEstimate } from '../poker/equity.ts';
import { formatChips } from '../ui/dom.ts';
import { cardLabel } from '../ui/components/card.ts';
import type { RoomPeer } from '../supabase/online-room.ts';

export type AppMode = 'practice' | 'online-lobby' | 'online-playing';
export type AiSettings = Readonly<{ level: AiLevel; count: number }>;
export type ArchivedHand = Readonly<{
  handNumber: number; completedAt: string; actions: readonly string[]; board: readonly string[];
  result: string; outcome?: 'win' | 'loss' | 'draw'; chipsChange?: number;
}>;

export const MIN_AI = 1;
export const MAX_AI = 7;
export const START_STACK = 1_000;

/** Named opponents. Seven is the maximum table size that still leaves a seat for the player. */
export const AI_ROSTER = [
  { id: 'table-ai-1', name: 'マキシマス' },
  { id: 'table-ai-2', name: 'ブルータス' },
  { id: 'table-ai-3', name: 'カエサル' },
  { id: 'table-ai-4', name: 'スパルタクス' },
  { id: 'table-ai-5', name: 'ネロ' },
  { id: 'table-ai-6', name: 'アウレリウス' },
  { id: 'table-ai-7', name: 'ティベリウス' },
] as const;

const NAME_KEY = 'poker-colosseum-player-name';
const AI_KEY = 'poker-colosseum-ai-settings';
const ARCHIVE_KEY = 'poker-practice-hand-archive';

function readStorage(key: string): string | null {
  try { return globalThis.localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string): void {
  try { globalThis.localStorage.setItem(key, value); } catch { /* Private browsing: keep the in-memory value. */ }
}

export function loadPlayerName(): string {
  return cleanNameInput(readStorage(NAME_KEY) ?? readStorage('poker-practice-player-name'), 'あなた');
}

export function loadAiSettings(): AiSettings {
  try {
    const parsed: unknown = JSON.parse(readStorage(AI_KEY) ?? '{}');
    const record = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
    const level = (AI_LEVELS as readonly unknown[]).includes(record.level) ? record.level as AiLevel : 'medium';
    const count = Number.isInteger(record.count) && (record.count as number) >= MIN_AI && (record.count as number) <= MAX_AI ? record.count as number : 3;
    return { level, count };
  } catch { return { level: 'medium', count: 3 }; }
}

function loadHandArchive(): ArchivedHand[] {
  try {
    const value: unknown = JSON.parse(readStorage(ARCHIVE_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item: unknown): item is ArchivedHand => {
      if (!item || typeof item !== 'object') return false;
      const r = item as Record<string, unknown>;
      return Number.isSafeInteger(r.handNumber)
        && typeof r.completedAt === 'string' && Number.isFinite(Date.parse(r.completedAt))
        && Array.isArray(r.actions) && r.actions.length <= 100
        && r.actions.every((a: unknown) => typeof a === 'string' && a.length <= 300)
        && Array.isArray(r.board) && r.board.length <= 5
        && r.board.every((c: unknown) => typeof c === 'string' && c.length <= 4)
        && typeof r.result === 'string' && r.result.length <= 500
        && (r.outcome === undefined || ['win', 'loss', 'draw'].includes(String(r.outcome)))
        && (r.chipsChange === undefined || Number.isSafeInteger(r.chipsChange));
    }).slice(0, 10);
  } catch { return []; }
}

export const store = {
  humanId: '',
  guestOnlineReady: false,
  guestError: false,
  playerName: loadPlayerName(),
  mode: 'practice' as AppMode,
  ai: loadAiSettings(),
  /** False until the player confirms the AI setup screen. */
  practiceStarted: false,
  table: null as TableState | null,
  aiThinking: false,
  notice: '',
  handHistory: [] as string[],
  recentHands: loadHandArchive(),
  archivedHand: null as object | null,
  humanStackAtHandStart: START_STACK,
  coachOpen: false,
  raiseOpen: false,
  raiseValue: 0,
  equityCache: new Map<string, EquityEstimate>(),
  online: {
    roomId: '', revision: 0, pollFailures: 0, sessionEpoch: 0, host: false, started: false,
    winnerId: null as string | null, status: '', error: '', peers: [] as RoomPeer[],
    names: new Map<string, string>(), pollTimer: undefined as number | undefined, pending: false,
  },
};

/** Set by main.ts so controllers can ask for a repaint without importing the views (avoids import cycles). */
export const hooks: { render: () => void; renderLobby: () => void } = { render: () => undefined, renderLobby: () => undefined };

export function savePlayerName(raw: string): void {
  store.playerName = cleanNameInput(raw, 'あなた');
  writeStorage(NAME_KEY, store.playerName);
}

export function saveAiSettings(settings: AiSettings): void {
  store.ai = settings;
  writeStorage(AI_KEY, JSON.stringify(settings));
}

export function saveArchive(): void {
  writeStorage(ARCHIVE_KEY, JSON.stringify(store.recentHands));
}
export function clearArchive(): void {
  store.recentHands = [];
  try { globalThis.localStorage.removeItem(ARCHIVE_KEY); } catch { /* Keep the in-memory archive cleared. */ }
}

export function isAiPlayer(id: string): boolean {
  return AI_ROSTER.some((ai) => ai.id === id);
}

export function playerLabel(id: string): string {
  if (id === store.humanId) return store.playerName;
  const online = store.online.names.get(id);
  if (online) return online;
  return AI_ROSTER.find((ai) => ai.id === id)?.name ?? 'プレイヤー';
}

export function stageLabel(stage: string): string {
  return ({ preflop: 'プリフロップ', flop: 'フロップ', turn: 'ターン', river: 'リバー', complete: 'ショーダウン' } as Record<string, string>)[stage] ?? stage;
}

export function actionNotice(name: string, action: BettingAction): string {
  if (action.type === 'fold') return `${name}はフォールドしました。`;
  if (action.type === 'check') return `${name}はチェックしました。`;
  if (action.type === 'call') return `${name}はコールしました。`;
  if (action.type === 'all-in') return `${name}はオールインしました。`;
  return `${name}は${formatChips(action.to)}チップに${action.type === 'bet' ? 'ベット' : 'レイズ'}しました。`;
}

export function archiveCompletedHand(): void {
  const table = store.table;
  const hand = table?.hand;
  if (!table || !hand || hand.stage !== 'complete' || store.archivedHand === hand || !hand.result) return;
  store.archivedHand = hand;
  const result = hand.result.type === 'uncontested'
    ? `${playerLabel(hand.result.winnerId)}がポット ${formatChips(hand.result.pot)} チップを獲得`
    : hand.result.settlement.pots.map((pot, index) => {
      const winners = pot.winnerIds.map(playerLabel).join('・');
      return `${index === 0 ? 'メイン' : `サイド${index}`} ${formatChips(pot.amount)}: ${winners}`;
    }).join(' / ');
  const refundSummary = hand.result.returned
    ? `未コール分 ${formatChips(hand.result.returned.amount)} チップを${playerLabel(hand.result.returned.playerId)}へ返却` : '';
  const finalStack = hand.players.find((p) => p.id === store.humanId)?.stack ?? store.humanStackAtHandStart;
  const chipsChange = finalStack - store.humanStackAtHandStart;
  const outcome: ArchivedHand['outcome'] = chipsChange > 0 ? 'win' : chipsChange < 0 ? 'loss' : 'draw';
  store.recentHands = [{
    handNumber: table.handNumber, completedAt: new Date().toISOString(), actions: [...store.handHistory],
    board: hand.board.map(cardLabel), result: refundSummary ? `${result} / ${refundSummary}` : result, outcome, chipsChange,
  }, ...store.recentHands].slice(0, 10);
  saveArchive();
}

export { getHandPot };
