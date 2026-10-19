import type { Card } from './poker/cards.ts';
import { formatChips, node } from './ui/dom.ts';
import { cardElement, cardLabel } from './ui/components/card.ts';
import { createActionButton } from './ui/components/action-button.ts';
import { renderSeat } from './ui/components/seat.ts';
import { pageLink, renderHandsPage, renderHomePage, renderTermsPage, staticPageHeader, type SitePage } from './ui/pages.ts';
import { applyTableAction, createTable, getPublicTableView, startNextHand, type TableState } from './poker/table.ts';
import { chooseAiAction, type AiStyle } from './poker/ai.ts';
import { getHandPot } from './poker/hand.ts';
import { getLegalActions, type BettingAction } from './poker/betting.ts';
import { evaluateHand } from './poker/evaluator.ts';
import { estimateEquity, type EquityEstimate } from './poker/equity.ts';
import { explainHand, getCallBreakEvenProbability } from './poker/education.ts';
import { initializeGuestIdentity } from './supabase/client.ts';
import { canApplyRoomUpdate, createRoom, joinRoom, leaveRoom, leaveRoomKeepalive, nextRoomHand, readRoom, rematchRoom, startRoom as startServerRoom, submitRoomAction, type OnlineRoom, type RoomPeer } from './supabase/online-room.ts';
import './style.css';

let humanId = '';
let guestIdentityOnlineReady = false;
let guestIdentityError = false;
const aiIds = Array.from({ length: 9 }, (_, index) => `table-ai-${index + 1}`);
const opponentCountOptions = [1, 3, 5] as const;
const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Application root is missing');
const routePath = window.location.pathname.replace(/\/+$/u, '') || '/';
const sitePage: SitePage = routePath === '/ai' ? 'ai'
  : routePath === '/online' ? 'online'
    : routePath === '/terms' ? 'terms'
      : routePath === '/hands' ? 'hands' : 'home';

const playerNameKey = 'poker-practice-player-name';
const handArchiveKey = 'poker-practice-hand-archive';
let playerName = loadPlayerName();
let opponentCount = loadOpponentCount();
let table: TableState | null = null;
let aiTimer: number | undefined;
let aiThinking = false;
let notice = 'あなたの番です。合法なアクションを選んでください。';
let handHistory: string[] = [];
type ArchivedHand = Readonly<{
  handNumber: number;
  completedAt: string;
  actions: readonly string[];
  board: readonly string[];
  result: string;
  outcome?: 'win' | 'loss' | 'draw';
  chipsChange?: number;
}>;
let recentHands = loadHandArchive();
let archivedHand: object | null = null;
let humanStackAtHandStart = 1_000;
let coachOpen = false;
const equityCache = new Map<string, EquityEstimate>();
type AppMode = 'practice' | 'online-lobby' | 'online-playing';
let appMode: AppMode = 'practice';
let onlineRoomId = '';
let onlineRevision = 0;
let onlinePollFailures = 0;
let onlineSessionEpoch = 0;
let onlineHost = false;
let onlineStarted = false;
let onlineWinnerId: string | null = null;
let onlineStatus = '';
let onlineError = '';
let onlinePeers: RoomPeer[] = [];
let onlineNames = new Map<string, string>();
let onlinePollTimer: number | undefined;
let onlinePending = false;
window.addEventListener('pagehide', () => {
  if (onlineRoomId) leaveRoomKeepalive(onlineRoomId);
});
document.addEventListener('visibilitychange', () => {
  if (onlineRoomId) startOnlinePolling();
});

function playerLabel(id: string): string {
  if (id === humanId) return playerName;
  const onlineName = onlineNames.get(id);
  if (onlineName) return onlineName;
  const index = aiIds.indexOf(id);
  const style = index === 0 ? '攻め' : index === 2 ? '堅実' : '標準';
  return index >= 0 ? `AI ${index + 1} · ${style}` : 'プレイヤー';
}

function currentEquity(): EquityEstimate | null {
  if (!table?.hand || table.hand.stage === 'complete') return null;
  const me = table.hand.players.find((player) => player.id === humanId);
  if (!me) return null;
  const opponents = table.hand.players.filter((player) => player.id !== humanId);
  const activeCount = opponents.filter((player) => !player.folded).length;
  if (activeCount === 0) return null;
  const key = [me.holeCards.map(cardLabel).join(','), table.hand.board.map(cardLabel).join(','), opponents.filter((player) => player.folded).length, activeCount].join('|');
  const cached = equityCache.get(key);
  if (cached) return cached;
  const estimate = estimateEquity(me.holeCards, table.hand.board, activeCount, opponents.length - activeCount, 240);
  equityCache.set(key, estimate);
  if (equityCache.size > 20) equityCache.delete(equityCache.keys().next().value!);
  return estimate;
}

function coachAdvice(equity: EquityEstimate, legal: ReturnType<typeof getLegalActions>, pot: number): string {
  if (!table?.hand) return '';
  const percent = (equity.equity * 100).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
  if (legal.callAmount > 0) {
    const required = getCallBreakEvenProbability(pot, legal.callAmount);
    const requiredPercent = (required * 100).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
    return equity.equity >= required
      ? `推定勝率は約${percent}%。コールの損益分岐点${requiredPercent}%を上回っています。相手の次のベットや推定誤差も考慮して判断しましょう。`
      : `推定勝率は約${percent}%。コールの損益分岐点${requiredPercent}%を下回っています。必要チップと相手の強さを見直しましょう。`;
  }
  if (legal.canCheck) return `推定勝率は約${percent}%。追加コストなしで次のカードを見られます。チェックで進むか、強い手からバリューを取るかを考えましょう。`;
  return `推定勝率は約${percent}%。この数字はランダムな相手の手札を使ったシミュレーションです。`;
}

function isAiPlayer(id: string): boolean {
  return aiIds.includes(id);
}

function aiStyle(id: string): AiStyle {
  const index = aiIds.indexOf(id);
  return index === 0 ? 'aggressive' : index === 2 ? 'cautious' : 'balanced';
}

function loadPlayerName(): string {
  try {
    return globalThis.localStorage.getItem(playerNameKey)?.trim().slice(0, 20) || 'あなた';
  } catch {
    return 'あなた';
  }
}

function loadOpponentCount(): number {
  try {
    const saved = Number(globalThis.localStorage.getItem('poker-practice-opponent-count'));
    return opponentCountOptions.includes(saved as (typeof opponentCountOptions)[number]) ? saved : 3;
  } catch {
    return 3;
  }
}

function loadHandArchive(): ArchivedHand[] {
  try {
    const value: unknown = JSON.parse(globalThis.localStorage.getItem(handArchiveKey) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item: unknown): item is ArchivedHand => {
      if (!item || typeof item !== 'object') return false;
      const record = item as Record<string, unknown>;
      return Number.isSafeInteger(record.handNumber)
        && typeof record.completedAt === 'string' && Number.isFinite(Date.parse(record.completedAt))
        && Array.isArray(record.actions) && record.actions.length <= 100
        && record.actions.every((action: unknown) => typeof action === 'string' && action.length <= 300)
        && Array.isArray(record.board) && record.board.length <= 5
        && record.board.every((card: unknown) => typeof card === 'string' && card.length <= 4)
        && typeof record.result === 'string' && record.result.length <= 500
        && (record.outcome === undefined || ['win', 'loss', 'draw'].includes(String(record.outcome)))
        && (record.chipsChange === undefined || Number.isSafeInteger(record.chipsChange));
    }).slice(0, 10);
  } catch {
    return [];
  }
}

function archiveCompletedHand(): void {
  const hand = table?.hand;
  if (!table || !hand || hand.stage !== 'complete' || archivedHand === hand || !hand.result) return;
  archivedHand = hand;
  const result = hand.result.type === 'uncontested'
    ? `${playerLabel(hand.result.winnerId)}がポット ${formatChips(hand.result.pot)} チップを獲得`
    : hand.result.settlement.pots.map((pot, index) => {
      const winners = pot.winnerIds.map(playerLabel).join('・');
      return `${index === 0 ? 'メイン' : `サイド${index}`} ${formatChips(pot.amount)}: ${winners}`;
    }).join(' / ');
  const refundSummary = hand.result.returned
    ? `未コール分 ${formatChips(hand.result.returned.amount)} チップを${playerLabel(hand.result.returned.playerId)}へ返却`
    : '';
  const humanFinalStack = hand.players.find((player) => player.id === humanId)?.stack ?? humanStackAtHandStart;
  const chipsChange = humanFinalStack - humanStackAtHandStart;
  const outcome: ArchivedHand['outcome'] = chipsChange > 0 ? 'win' : chipsChange < 0 ? 'loss' : 'draw';
  recentHands = [{
    handNumber: table.handNumber,
    completedAt: new Date().toISOString(),
    actions: [...handHistory],
    board: hand.board.map(cardLabel),
    result: refundSummary ? `${result} / ${refundSummary}` : result,
    outcome,
    chipsChange,
  }, ...recentHands].slice(0, 10);
  try { globalThis.localStorage.setItem(handArchiveKey, JSON.stringify(recentHands)); } catch { /* Keep the in-memory summary if storage is unavailable. */ }
}

function startGame(): void {
  appMode = 'practice';
  if (aiTimer) window.clearTimeout(aiTimer);
  aiThinking = false;
  table = createTable([
    { id: humanId, stack: 1_000 },
    ...aiIds.slice(0, opponentCount).map((id) => ({ id, stack: 1_000 })),
  ], 5, 10);
  table = startNextHand(table);
  humanStackAtHandStart = 1_000;
  archivedHand = null;
  handHistory = [];
  coachOpen = false;
  notice = 'あなたの番です。チェック、コール、レイズなどを選べます。';
  render();
  runAiIfNeeded();
}

function performAction(action: BettingAction): void {
  if (!table || !table.hand || table.hand.stage === 'complete' || aiThinking) return;
  if (appMode === 'online-playing') {
    if (onlinePending) return;
    const actionRoomId = onlineRoomId;
    onlinePending = true;
    notice = '操作を送信しています…';
    render();
    void submitRoomAction(actionRoomId, table.version, action).then((room) => applyOnlineRoom(room, actionRoomId)).catch((error: unknown) => {
      onlineError = error instanceof Error ? error.message : '操作を反映できませんでした。';
      render();
      void refreshOnlineRoom();
    }).finally(() => { onlinePending = false; render(); });
    return;
  }
  try {
    const actionStage = stageLabel(table.hand.stage);
    table = applyTableAction(table, table.version, humanId, action);
    notice = actionNotice(playerName, action);
    handHistory.push(`${actionStage} · ${notice}`);
    render();
    runAiIfNeeded();
  } catch (error) {
    notice = error instanceof Error ? error.message : '操作を反映できませんでした。';
    render();
  }
}

function actionNotice(name: string, action: BettingAction): string {
  if (action.type === 'fold') return `${name}はフォールドしました。`;
  if (action.type === 'check') return `${name}はチェックしました。`;
  if (action.type === 'call') return `${name}はコールしました。`;
  if (action.type === 'all-in') return `${name}はオールインしました。`;
  return `${name}は${formatChips(action.to)}チップに${action.type === 'bet' ? 'ベット' : 'レイズ'}しました。`;
}

function changeMode(mode: AppMode): void {
  appMode = mode;
  render();
}

async function closeOnlineSession(): Promise<void> {
  onlineSessionEpoch++;
  if (onlinePollTimer) window.clearTimeout(onlinePollTimer);
  onlinePollTimer = undefined;
  const roomId = onlineRoomId;
  if (roomId) {
    try { await leaveRoom(roomId); } catch { /* The player can still return to practice if the server is unreachable. */ }
  }
  onlineRoomId = '';
  onlineRevision = 0;
  onlinePollFailures = 0;
  onlineStarted = false;
  onlineWinnerId = null;
  onlinePeers = [];
  onlineNames.clear();
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}

function applyOnlineRoom(room: OnlineRoom, expectedRoomId?: string): void {
  if (!canApplyRoomUpdate(onlineRoomId, room.roomId, expectedRoomId, onlineRevision, room.revision, table, room.table)) return;
  onlineError = '';
  onlineRoomId = room.roomId;
  onlineRevision = room.revision;
  onlineHost = room.hostId === humanId;
  onlineStarted = room.status === 'playing';
  onlineWinnerId = room.winnerId;
  onlinePeers = [...room.peers];
  onlineNames = new Map(room.peers.map((peer) => [peer.id, peer.name]));
  if (room.table) {
    if (table?.handNumber !== room.table.handNumber && table?.hand) {
      humanStackAtHandStart = table.hand.players.find((player) => player.id === humanId)?.stack ?? humanStackAtHandStart;
      archivedHand = null;
      handHistory = [];
    }
    table = room.table;
  } else if (room.status === 'waiting') {
    table = null;
  }
  notice = room.notice || (room.status === 'playing' ? '対戦中です。' : '参加者を待っています。');
  onlineStatus = room.status === 'waiting' ? '招待リンクを共有して友だちを待ちます' : room.status === 'finished' ? '対戦終了' : 'オンライン対戦中';
  appMode = room.status === 'waiting' ? 'online-lobby' : 'online-playing';
  render();
}

async function refreshOnlineRoom(): Promise<void> {
  if (!onlineRoomId || onlinePending) return;
  const requestedRoomId = onlineRoomId;
  try {
    const result = await readRoom(requestedRoomId, onlineRevision);
    onlinePollFailures = 0;
    const hadError = Boolean(onlineError);
    onlineError = '';
    if ('unchanged' in result) {
      onlineRevision = result.revision;
      if (hadError) render();
    }
    else applyOnlineRoom(result, requestedRoomId);
  }
  catch (error) {
    onlinePollFailures++;
    onlineError = error instanceof Error ? error.message : 'ルーム状態を取得できませんでした。';
    if (appMode === 'online-lobby') renderOnlineLobby();
    else render();
  }
}

function startOnlinePolling(): void {
  if (onlinePollTimer) window.clearTimeout(onlinePollTimer);
  const schedule = (): void => {
    if (!onlineRoomId) return;
    const baseDelay = document.hidden ? 10_000 : 1_500;
    const delay = onlinePollFailures === 0 ? baseDelay : Math.min(30_000, baseDelay * 2 ** Math.min(onlinePollFailures, 5));
    onlinePollTimer = window.setTimeout(() => {
      void refreshOnlineRoom().finally(schedule);
    }, delay);
  };
  schedule();
}

async function createOnlineRoom(): Promise<void> {
  const requestEpoch = onlineSessionEpoch;
  try {
    if (!guestIdentityOnlineReady) throw new Error('オンライン対戦を利用できません。Supabase設定と匿名ログインを確認してください。');
    const room = await createRoom(playerName);
    if (requestEpoch !== onlineSessionEpoch) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#room=${room.roomId}`);
    appMode = 'online-lobby';
    applyOnlineRoom(room);
    startOnlinePolling();
  } catch (error) {
    onlineError = error instanceof Error ? error.message : 'ルームを作成できませんでした。';
    renderOnlineLobby();
  }
}

async function joinOnlineRoom(roomId: string): Promise<void> {
  if (!/^[a-f0-9]{36}$/u.test(roomId)) { onlineError = '招待リンクが正しくありません。'; renderOnlineLobby(); return; }
  const requestEpoch = onlineSessionEpoch;
  try {
    if (!guestIdentityOnlineReady) throw new Error('オンライン対戦を利用できません。Supabase設定と匿名ログインを確認してください。');
    const room = await joinRoom(roomId, playerName);
    if (requestEpoch !== onlineSessionEpoch) return;
    appMode = room.status === 'playing' ? 'online-playing' : 'online-lobby';
    applyOnlineRoom(room);
    startOnlinePolling();
  }
  catch (error) { onlineError = error instanceof Error ? error.message : 'ルームに参加できませんでした。'; renderOnlineLobby(); }
}

function startOnlineGame(): void {
  if (!onlineHost || onlinePeers.length < 2) { onlineError = '友だちが参加するまで待ってください。'; renderOnlineLobby(); return; }
  const requestRoomId = onlineRoomId;
  void startServerRoom(requestRoomId).then((room) => applyOnlineRoom(room, requestRoomId)).catch((error: unknown) => {
    onlineError = error instanceof Error ? error.message : '対戦を開始できませんでした.';
    renderOnlineLobby();
  });
}

function runAiIfNeeded(): void {
  const round = table?.hand?.bettingRound;
  if (!table?.hand || !round?.actorId || !isAiPlayer(round.actorId) || table.hand.stage === 'complete' || aiThinking) return;
  const actorId = round.actorId;
  aiThinking = true;
  notice = `${playerLabel(actorId)}が考えています…`;
  render();
  aiTimer = window.setTimeout(() => {
    if (!table?.hand?.bettingRound || table.hand.bettingRound.actorId !== actorId) {
      aiThinking = false;
      return;
    }
    const hand = table.hand;
    const player = hand.players.find((candidate) => candidate.id === actorId);
    if (!player || !hand.bettingRound) {
      aiThinking = false;
      return;
    }
    try {
      const actionStage = stageLabel(hand.stage);
      const action = chooseAiAction({
        playerId: actorId,
        holeCards: player.holeCards,
        board: hand.board,
        legalActions: getLegalActions(hand.bettingRound, actorId),
        stack: player.stack,
        pot: getHandPot(hand),
        streetContribution: player.streetContribution,
        currentBet: hand.bettingRound.currentBet,
        style: aiStyle(actorId),
        activeOpponentCount: hand.players.filter((candidate) => candidate.id !== actorId && !candidate.folded).length,
      });
      table = applyTableAction(table, table.version, actorId, action);
      notice = actionNotice(playerLabel(actorId), action);
      handHistory.push(`${actionStage} · ${notice}`);
    } catch (error) {
      notice = error instanceof Error ? error.message : `${playerLabel(actorId)}の操作を反映できませんでした。`;
    }
    aiThinking = false;
    render();
    runAiIfNeeded();
  }, 550);
}

function renderOnlineLobby(): void {
  document.title = '友だちとオンライン対戦 — POKER TABLE';
  const shell = node('main', 'page-shell lobby-shell');
  shell.append(staticPageHeader(sitePage));
  const intro = node('section', 'intro lobby-intro');
  intro.append(node('div', 'eyebrow', 'PRIVATE TABLE / PLAY WITH FRIENDS'));
  intro.append(node('h1', '', 'リンクを送って、すぐ対戦。'));
  intro.append(node('p', 'intro-copy', 'ゲスト名を入れて部屋を作り、招待リンクを共有するだけ。手札は本人だけに表示されます。'));
  shell.append(intro);

  const panel = node('section', 'lobby-panel');
  const nameField = node('label', 'lobby-name-field');
  nameField.append(node('span', '', 'プレイヤー名'));
  const nameInput = node('input', 'player-name-input') as HTMLInputElement;
  nameInput.value = playerName;
  nameInput.maxLength = 20;
  nameInput.disabled = Boolean(onlineRoomId);
  nameInput.addEventListener('change', () => {
    playerName = nameInput.value.trim().slice(0, 20) || 'あなた';
    try { globalThis.localStorage.setItem(playerNameKey, playerName); } catch { /* Local identity still applies. */ }
    onlineNames.set(humanId, playerName);
    renderOnlineLobby();
  });
  nameField.append(nameInput);
  panel.append(nameField);

  if (!onlineRoomId) {
    const create = node('button', 'action-button primary-action lobby-create', '対戦ルームを作る');
    create.type = 'button';
    create.addEventListener('click', () => { void createOnlineRoom(); });
    panel.append(create, node('div', 'lobby-divider', 'または招待リンクから参加'));
    const joinRow = node('div', 'lobby-join-row');
    const roomInput = node('input', 'room-link-input') as HTMLInputElement;
    roomInput.placeholder = '招待リンクまたはルームID';
    roomInput.setAttribute('aria-label', '招待リンクまたはルームID');
    const join = node('button', 'action-button secondary-action', '参加');
    join.type = 'button';
    join.addEventListener('click', () => {
      const match = roomInput.value.match(/(?:#room=)?([a-f0-9]{36})$/u);
      if (match?.[1]) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#room=${match[1]}`);
        void joinOnlineRoom(match[1]);
      } else { onlineError = '有効な招待リンクまたはルームIDを入力してください。'; renderOnlineLobby(); }
    });
    joinRow.append(roomInput, join);
    panel.append(joinRow);
  } else {
    const invite = `${window.location.origin}${window.location.pathname}${window.location.search}#room=${onlineRoomId}`;
    panel.append(node('h2', 'lobby-section-title', onlineHost ? '友だちを招待' : 'ルームに参加中'));
    const inviteRow = node('div', 'lobby-invite-row');
    const inviteInput = node('input', 'room-link-input') as HTMLInputElement;
    inviteInput.value = invite;
    inviteInput.readOnly = true;
    inviteInput.setAttribute('aria-label', '招待リンク');
    const copy = node('button', 'action-button secondary-action', 'リンクをコピー');
    copy.type = 'button';
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(invite).then(() => { onlineStatus = '招待リンクをコピーしました'; renderOnlineLobby(); })
        .catch(() => { inviteInput.select(); onlineStatus = 'リンクを選択しました。コピーしてください'; renderOnlineLobby(); });
    });
    inviteRow.append(inviteInput, copy);
    if (typeof navigator.share === 'function') {
      const share = node('button', 'action-button secondary-action', '共有');
      share.type = 'button';
      share.addEventListener('click', () => {
        void navigator.share({ title: 'ポーカーに招待', text: '一緒にポーカーを遊ぼう', url: invite })
          .catch(() => { /* Closing the native share sheet is not an error. */ });
      });
      inviteRow.append(share);
    }
    panel.append(inviteRow);
    const retry = node('button', 'action-button secondary-action lobby-retry', '状態を更新');
    retry.type = 'button';
    retry.addEventListener('click', () => { void refreshOnlineRoom(); });
    panel.append(retry);
    panel.append(node('p', 'lobby-status', onlineStatus || (onlineHost ? '友だちの参加を待っています' : 'ホストに接続しています')));
    const roster = node('ul', 'lobby-roster');
    for (const peer of onlinePeers) {
      const item = node('li', 'lobby-player');
      item.append(node('span', `lobby-presence ${peer.connected ? 'is-connected' : 'is-disconnected'}`), node('strong', '', peer.id === humanId ? `${peer.name}（あなた）` : peer.name));
      item.append(node('span', 'lobby-connection', peer.connected ? '在席' : '離席'));
      roster.append(item);
    }
    if (!onlinePeers.length) roster.append(node('li', 'lobby-empty', '参加者を確認しています…'));
    panel.append(roster);
    if (onlineStarted) {
      const backToTable = node('button', 'action-button primary-action lobby-create', 'テーブルに戻る');
      backToTable.type = 'button';
      backToTable.addEventListener('click', () => { appMode = 'online-playing'; render(); });
      panel.append(backToTable);
    } else if (onlineHost) {
        const start = node('button', 'action-button primary-action lobby-create', '対戦を開始');
        start.type = 'button';
        start.disabled = onlinePeers.filter((peer) => peer.connected).length < 2;
        start.addEventListener('click', startOnlineGame);
        panel.append(start);
    } else panel.append(node('p', 'lobby-waiting', 'ホストが対戦を開始すると自動でテーブルに移動します。'));
  }
  if (onlineError) panel.append(node('p', 'lobby-error', onlineError));
  const practice = node('button', 'lobby-back', 'ひとりで練習する');
  practice.type = 'button';
  practice.addEventListener('click', () => {
    void closeOnlineSession().finally(() => { window.location.assign('/ai'); });
  });
  panel.append(practice);
  shell.append(panel);
  shell.append(node('footer', 'footer-note', 'プレイチップのみ · 現金や賞金はありません · ルーム状態はサーバーに保存されます'));
  app!.replaceChildren(shell);
}

function render(): void {
  if (appMode === 'online-lobby') { renderOnlineLobby(); return; }
  if (!table?.hand) return;
  document.title = appMode === 'online-playing' ? 'オンライン対戦 — POKER TABLE' : 'AI対戦 — POKER TABLE';
  archiveCompletedHand();
  const view = getPublicTableView(table, humanId);
  const hand = table.hand;
  const equity = currentEquity();
  const me = hand.players.find((player) => player.id === humanId);
  const round = hand.bettingRound;
  const isHumanTurn = !aiThinking && round?.actorId === humanId && hand.stage !== 'complete';
  const legal = isHumanTurn && round ? getLegalActions(round, humanId) : null;
  const shell = node('main', `page-shell play-shell${appMode === 'online-playing' ? ' online-play-shell' : ''}`);

  const header = node('header', 'topbar');
  const brand = pageLink('POKER TABLE', '/', false);
  brand.classList.add('brand');
  brand.setAttribute('aria-label', 'ポーカーテーブル ホーム');
  const playerControl = node('label', 'player-name-control');
  playerControl.append(node('span', '', '名前'));
  const playerNameInput = node('input', 'player-name-input') as HTMLInputElement;
  playerNameInput.type = 'text';
  playerNameInput.value = playerName;
  playerNameInput.maxLength = 20;
  playerNameInput.setAttribute('autocomplete', 'nickname');
  playerNameInput.setAttribute('aria-label', 'プレイヤー名');
  playerNameInput.addEventListener('change', () => {
    playerName = playerNameInput.value.trim().slice(0, 20) || 'あなた';
    try { globalThis.localStorage.setItem(playerNameKey, playerName); } catch { /* Storage can be unavailable in private browsing. */ }
    render();
  });
  playerControl.append(playerNameInput);
  header.append(brand, playerControl, node('span', 'practice-tag', appMode === 'online-playing' ? 'オンライン卓' : 'AI対戦'));
  shell.append(header);

  const intro = node('section', 'intro');
  intro.append(node('div', 'eyebrow', 'TEXAS HOLD’EM / TABLE 01'));
  intro.append(node('h1', '', '一手ずつ、覚えていこう。'));
  intro.append(node('p', 'intro-copy', appMode === 'online-playing'
    ? '招待した友だちとテキサスホールデム。手札は本人だけに表示され、配札と進行はサーバーが管理します。'
    : '個性の異なるAIとテキサスホールデムを練習。勝率の目安とコーチの解説を見ながら、チップを賭ける判断を試せます。'));
  shell.append(intro);
  const playModeBar = node('section', 'play-mode-bar');
  playModeBar.append(node('span', 'play-mode-copy', appMode === 'online-playing' ? '友だちとの対戦中' : 'AIと練習中'));
  const onlineButton = pageLink(appMode === 'online-playing' ? 'ルーム情報・招待リンク' : '友だちとオンライン対戦 →', appMode === 'online-playing' ? `/online#room=${onlineRoomId}` : '/online');
  onlineButton.classList.add('online-entry-button');
  playModeBar.append(onlineButton);
  shell.append(playModeBar);
  const beginnerGuide = node('details', 'beginner-guide');
  beginnerGuide.append(node('summary', '', 'はじめての方へ：遊び方を見る'));
  const guideBody = node('div', 'guide-body');
  guideBody.append(node('p', '', '手札2枚と、テーブル中央に順番に出る共通カード5枚から、いちばん強い5枚の役を作ります。'));
  guideBody.append(node('p', '', '自分の番では、チェック（追加せず進む）、コール（相手に合わせる）、レイズ（ベットを上げる）、フォールド（そのハンドを降りる）などを選びます。'));
  guideBody.append(node('p', '', 'ほかのプレイヤーより多くのチップを獲得することを目指します。ひとり練習の状態は端末内だけで管理され、ゲーム内チップに金銭的価値はありません。'));
  beginnerGuide.append(guideBody);
  shell.append(beginnerGuide);
  const tableSettings = node('section', 'practice-settings');
  const opponentLabel = node('label', 'opponent-count-control');
  opponentLabel.append(node('span', '', '対戦するAIの人数'));
  const opponentSelect = node('select', 'opponent-count-select') as HTMLSelectElement;
  opponentSelect.setAttribute('aria-label', '対戦するAIの人数');
  for (const count of opponentCountOptions) {
    const option = node('option', '', `AI ${count}人`);
    option.value = String(count);
    opponentSelect.append(option);
  }
  opponentSelect.value = String(opponentCount);
  opponentSelect.addEventListener('change', () => {
    const selected = Number(opponentSelect.value);
    if (!opponentCountOptions.includes(selected as (typeof opponentCountOptions)[number])) return;
    opponentCount = selected;
    try { globalThis.localStorage.setItem('poker-practice-opponent-count', String(opponentCount)); } catch { /* The in-memory preference still applies for this session. */ }
    startGame();
  });
  opponentLabel.append(opponentSelect);
  tableSettings.append(opponentLabel, node('span', 'settings-hint', '人数を変えると新しいハンドから再開します。'));
  if (appMode === 'practice') shell.append(tableSettings);

  const playLayout = node('div', 'play-layout');
  const secondaryInfo = node('div', 'secondary-info');
  const tableCard = node('section', 'game-panel');
  const panelHeader = node('div', 'panel-header');
  const handMeta = node('div', 'hand-meta');
  const level = Math.floor((table.handNumber - 1) / 10) + 1;
  handMeta.append(node('span', 'panel-label', `ハンド ${table.handNumber} · ${stageLabel(hand.stage)}`));
  handMeta.append(node('span', 'blind-level', `LEVEL ${level} · SB ${formatChips(table.smallBlind)} / BB ${formatChips(table.bigBlind)}`));
  panelHeader.append(handMeta);
  const actingPlayerId = round?.actorId;
  const turnText = hand.stage === 'complete' ? 'ハンド終了'
    : isHumanTurn ? 'あなたの番'
      : aiThinking ? '相手の思考中'
        : actingPlayerId ? `${playerLabel(actingPlayerId)}の番` : '進行中';
  panelHeader.append(node('span', `turn-indicator${isHumanTurn ? ' your-turn' : ''}`, turnText));
  tableCard.append(panelHeader);

  const felt = node('div', 'felt');
  const largestStack = Math.max(1, ...(view.hand?.players.map((player) => player.stack) ?? []));
  const opponents = node('div', 'opponent-seats');
  for (const opponent of (view.hand?.players ?? []).filter((player) => player.id !== humanId)) {
    opponents.append(renderSeat(playerLabel(opponent.id), opponent, opponent.id === round?.actorId, false, table.buttonPlayerId === opponent.id, Boolean(opponent.holeCards), opponent.stack / largestStack, onlineNames.has(opponent.id)));
  }
  felt.append(opponents);

  const center = node('div', 'table-center');
  center.append(node('div', 'pot-label', 'POT'));
  const potValue = node('div', 'pot-value');
  potValue.append(document.createTextNode(formatChips(view.hand?.pot ?? 0)), node('small', '', ' CHIPS'));
  center.append(potValue);
  if (equity) {
    const equityStrip = node('div', 'equity-strip');
    equityStrip.append(node('span', 'equity-label', 'あなたの勝率'), node('strong', 'equity-value', `${(equity.win * 100).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}%`));
    equityStrip.append(node('span', 'equity-detail', `引き分け ${(equity.tie * 100).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}% · ${equity.samples}回推定`));
    center.append(equityStrip);
  }
  const board = node('div', 'card-row community-cards');
  const boardCards = view.hand?.board ?? [];
  for (let index = 0; index < 5; index++) board.append(cardElement(boardCards[index] ?? null, !boardCards[index]));
  center.append(board);
  felt.append(center);

  const human = view.hand?.players.find((player) => player.id === humanId);
  felt.append(renderSeat(playerName, human, isHumanTurn, true, table.buttonPlayerId === humanId, false, (human?.stack ?? 0) / largestStack, onlineNames.has(humanId)));
  tableCard.append(felt);

  const noticeBar = node('div', 'notice-bar');
  noticeBar.classList.toggle('notice-error', Boolean(onlineError));
  noticeBar.setAttribute('role', 'status');
  noticeBar.setAttribute('aria-live', 'polite');
  noticeBar.append(node('span', 'notice-dot'), node('span', '', onlineError || notice));
  tableCard.append(noticeBar);
  playLayout.append(tableCard);

  const historyDetails = node('details', 'hand-history');
  const historySummary = node('summary', '', `このハンドの履歴 (${handHistory.length})`);
  historyDetails.append(historySummary);
  const historyList = node('ol', 'history-list');
  if (handHistory.length === 0) historyList.append(node('li', 'history-empty', '最初のアクション後にここへ記録されます。'));
  else for (const event of handHistory) historyList.append(node('li', '', event));
  historyDetails.append(historyList);
  secondaryInfo.append(historyDetails);

  if (me && hand.board.length >= 3 && hand.stage !== 'complete') {
    const evaluated = evaluateHand([...me.holeCards, ...hand.board]);
    const explanation = explainHand(evaluated);
    const lesson = node('section', 'lesson-card');
    lesson.append(node('span', 'lesson-icon', '✳'));
    const lessonText = node('div', 'lesson-text');
    lessonText.append(node('span', 'lesson-kicker', 'あなたの現在の役'));
    lessonText.append(node('strong', 'lesson-title', explanation.name));
    lessonText.append(node('p', 'lesson-copy', explanation.reason));
    const madeWith = node('div', 'made-with');
    for (const item of explanation.cards) {
      const chip = node('span', 'mini-card', item.label);
      if (item.card.suit === 'hearts' || item.card.suit === 'diamonds') chip.classList.add('red-suit');
      madeWith.append(chip);
    }
    lessonText.append(madeWith);
    lesson.append(lessonText);
    secondaryInfo.append(lesson);
  } else if (hand.stage !== 'complete') {
    secondaryInfo.append(node('div', 'lesson-placeholder', 'フロップが公開されると、現在成立している役と構成カードをここに表示します。'));
  }

  const actionPanel = node('section', 'action-panel');
  const actionHeading = node('div', 'action-heading');
  actionHeading.append(node('h2', '', hand.stage === 'complete' ? '次のハンド' : isHumanTurn ? 'あなたのアクション' : '相手のアクション中'));
  if (me) actionHeading.append(node('span', 'stack-summary', `残り ${formatChips(me.stack)} チップ`));
  actionPanel.append(actionHeading);

  if (hand.stage === 'complete') {
    const result = hand.result;
    if (result?.type === 'showdown') {
      const winners = Object.entries(result.settlement.payouts).filter(([, amount]) => amount > 0);
      actionPanel.append(node('p', 'result-copy', winners.map(([id, amount]) => `${playerLabel(id)} +${formatChips(amount)}`).join('　') || 'ショーダウンが終了しました。'));
      const revealedHands = node('div', 'revealed-hands');
      for (const [id, evaluated] of Object.entries(result.settlement.hands)) {
        const handResult = node('div', 'revealed-hand');
        handResult.append(node('strong', '', `${playerLabel(id)} · ${explainHand(evaluated).name}`));
        const cards = node('div', 'card-row result-cards');
        const player = view.hand?.players.find((candidate) => candidate.id === id);
        if (player?.holeCards) for (const card of player.holeCards) cards.append(cardElement(card));
        handResult.append(cards);
        revealedHands.append(handResult);
      }
      actionPanel.append(revealedHands);
      result.settlement.pots.forEach((pot, index) => {
        const potWinners = pot.winnerIds.map(playerLabel).join('・');
        actionPanel.append(node('p', 'pot-result', `${index === 0 ? 'メインポット' : `サイドポット ${index}`} · ${formatChips(pot.amount)} チップ · ${potWinners}が獲得`));
      });
    } else if (result?.type === 'uncontested') {
      actionPanel.append(node('p', 'result-copy', `${playerLabel(result.winnerId)}が全員のフォールドでポット ${formatChips(result.pot)} を獲得しました。`));
    }
    if (onlineWinnerId) {
      actionPanel.append(node('p', 'result-copy', `${playerLabel(onlineWinnerId)}がこの対戦に優勝しました。`));
      const rematch = node('button', 'action-button primary-action', 'リマッチする');
      rematch.type = 'button';
      rematch.disabled = onlinePending;
      rematch.addEventListener('click', () => {
        if (onlinePending) return;
        const requestRoomId = onlineRoomId;
        onlinePending = true;
        void rematchRoom(requestRoomId).then((room) => applyOnlineRoom(room, requestRoomId)).catch((error: unknown) => {
          onlineError = error instanceof Error ? error.message : 'リマッチを開始できませんでした。';
          render();
        }).finally(() => { onlinePending = false; render(); });
      });
      actionPanel.append(rematch);
    }
    if (result?.returned) {
      actionPanel.append(node('p', 'result-copy', `未コール分 ${formatChips(result.returned.amount)} チップを${playerLabel(result.returned.playerId)}へ返却しました。`));
    }
    const canContinue = (table.seats.find((seat) => seat.id === humanId)?.stack ?? 0) > 0
      && table.seats.filter((seat) => seat.stack > 0).length >= 2;
    const connectedPlayer = appMode !== 'online-playing' || onlinePeers.some((peer) => peer.id === humanId && peer.connected);
    const hostCanContinue = appMode !== 'online-playing' || (connectedPlayer && canContinue);
    const nextButton = node('button', 'action-button primary-action', canContinue ? '次のハンドへ' : '次のハンドを開始できません');
    nextButton.type = 'button';
    nextButton.disabled = !hostCanContinue || onlinePending;
    nextButton.addEventListener('click', () => {
      try {
        if (appMode === 'online-playing') {
          if (!onlinePending) {
            const requestRoomId = onlineRoomId;
            onlinePending = true;
            void nextRoomHand(requestRoomId, table!.version).then((room) => applyOnlineRoom(room, requestRoomId)).catch((error: unknown) => {
              onlineError = error instanceof Error ? error.message : '次のハンドを開始できませんでした。';
              render();
              void refreshOnlineRoom();
            }).finally(() => { onlinePending = false; render(); });
          }
        } else if (canContinue) {
          humanStackAtHandStart = table!.seats.find((seat) => seat.id === humanId)?.stack ?? 0;
          table = startNextHand(table!);
          handHistory = [];
          archivedHand = null;
        } else startGame();
        notice = 'あなたの番です。';
        render();
        if (appMode !== 'online-playing') runAiIfNeeded();
      } catch (error) {
        if (appMode === 'online-playing') {
          onlineError = error instanceof Error ? error.message : '次のハンドを開始できませんでした。';
          render();
          void refreshOnlineRoom();
        } else startGame();
      }
    });
    if (!onlineWinnerId) actionPanel.append(nextButton);
  } else if (legal && me) {
    const actions = node('div', 'action-grid');
    actions.append(createActionButton('フォールド', { type: 'fold' }, 'fold-action', !legal.canFold || onlinePending, performAction));
    if (legal.canCheck) actions.append(createActionButton('チェック', { type: 'check' }, 'secondary-action', onlinePending, performAction));
    else actions.append(createActionButton(`コール ${formatChips(legal.callAmount)}`, { type: 'call' }, 'secondary-action', legal.callAmount === 0 || onlinePending, performAction));
    if (legal.canRaise) {
      const wager = node('div', 'wager-control');
      const range = node('input', 'wager-range') as HTMLInputElement;
      range.type = 'range';
      range.min = String(Math.min(legal.minRaiseTo, legal.maxRaiseTo));
      range.max = String(legal.maxRaiseTo);
      range.value = range.min;
      range.disabled = onlinePending;
      range.setAttribute('aria-label', 'ベットまたはレイズ額');
      const amount = node('output', 'wager-amount', formatChips(Number(range.value)));
      const updateWager = (): void => {
        amount.textContent = formatChips(Number(range.value));
        wagerButton.textContent = `${round!.currentBet === 0 ? 'ベット' : 'レイズ'} ${formatChips(Number(range.value))}`;
      };
      range.addEventListener('input', updateWager);
      const wagerButton = node('button', 'action-button primary-action', `${round!.currentBet === 0 ? 'ベット' : 'レイズ'} ${amount.textContent}`);
      wagerButton.type = 'button';
      wagerButton.disabled = aiThinking || onlinePending;
      wagerButton.addEventListener('click', () => {
        const target = Number(range.value);
        performAction(target === legal.maxRaiseTo && target < legal.minRaiseTo
          ? { type: 'all-in' }
          : { type: round!.currentBet === 0 ? 'bet' : 'raise', to: target });
      });
      const presets = node('div', 'wager-presets');
      const setPreset = (target: number): void => {
        const min = Number(range.min);
        const max = Number(range.max);
        range.value = String(Math.max(min, Math.min(max, target)));
        range.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const pot = view.hand?.pot ?? 0;
      const amountToMatch = round!.currentBet === 0 ? 0 : legal.callAmount;
      const potAfterCall = pot + amountToMatch;
      const potTarget = (fraction: number): number => round!.currentBet === 0
        ? Math.floor(pot * fraction)
        : round!.currentBet + Math.floor(potAfterCall * fraction);
      for (const preset of [
        { label: '最小', target: Number(range.min) },
        { label: '1/2ポット', target: potTarget(0.5) },
        { label: 'ポット', target: potTarget(1) },
      ]) {
        const presetButton = node('button', 'wager-preset', preset.label);
        presetButton.type = 'button';
        presetButton.disabled = onlinePending;
        presetButton.setAttribute('aria-label', `${preset.label}サイズを選択`);
        presetButton.addEventListener('click', () => setPreset(preset.target));
        presets.append(presetButton);
      }
      wager.append(amount, range, presets, wagerButton);
      actions.append(wager);
    }
    const canMoveAllIn = legal.canRaise || me.stack <= legal.callAmount;
    if (me.stack > 0 && canMoveAllIn) actions.append(createActionButton('オールイン', { type: 'all-in' }, 'allin-action', onlinePending, performAction));
    actionPanel.append(actions);
    const callInfo = legal.callAmount ? `コールに必要なチップ: ${formatChips(legal.callAmount)}` : '追加ベットがなければチェックできます。';
    actionPanel.append(node('p', 'action-hint', `${callInfo} · ポット ${formatChips(view.hand?.pot ?? 0)} チップ${legal.canRaise ? ` · 最小${round!.currentBet === 0 ? 'ベット' : 'レイズ'} ${formatChips(legal.minRaiseTo)}` : ''}`));
    if (legal.callAmount > 0) {
      const pot = view.hand?.pot ?? 0;
      const threshold = getCallBreakEvenProbability(pot, legal.callAmount);
      const percent = (threshold * 100).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
      actionPanel.append(node('p', 'pot-odds', `単純計算の必要勝率の目安: ${percent}%`));
      actionPanel.append(node('p', 'action-guidance', 'コールした場合に損益が分かれる目安です。引き分けや次のストリートのベット、実際の勝率は含みません。'));
    }
    const callRequired = round!.currentBet - me.streetContribution;
    const guidance = legal.canCheck
      ? 'チェックはチップを追加せずに順番を進めます。誰かがベットすると、次の番ではコールかフォールドを選びます。'
      : legal.callAmount < callRequired
        ? 'コール額が残りチップを超えているため、コールを選ぶとオールインになります。フォールドすると、このハンドから降ります。'
        : 'コールは現在のベットに必要な分を出します。フォールドすると、このハンドから降り、すでに出したチップは戻りません。';
    actionPanel.append(node('p', 'action-guidance', guidance));
    if (legal.canRaise) actionPanel.append(node('p', 'action-guidance', `ベットはまだ誰も賭けていないとき、レイズは相手のベットを上げるときに使います。スライダーの金額は、このラウンドで出す合計額です。`));
    if (equity) {
      const coach = node('section', 'coach-box');
      const coachButton = node('button', 'coach-toggle', coachOpen ? 'コーチのアドバイスを閉じる' : 'AIコーチに相談');
      coachButton.type = 'button';
      coachButton.setAttribute('aria-expanded', String(coachOpen));
      coachButton.addEventListener('click', () => { coachOpen = !coachOpen; render(); });
      coach.append(coachButton);
      if (coachOpen) {
        coach.append(node('p', 'coach-copy', coachAdvice(equity, legal, view.hand?.pot ?? 0)));
        coach.append(node('p', 'coach-caveat', '勝率は未知の手札をランダムに配ったシミュレーションです。相手のプレイ傾向や将来のベットは含みません。'));
      }
      actionPanel.append(coach);
    }
  } else {
    actionPanel.append(node('p', 'action-waiting', '順番が来ると、ここに操作ボタンが表示されます。'));
  }
  playLayout.append(actionPanel);
  shell.append(playLayout, secondaryInfo);

  const archive = node('details', 'recent-hands');
  archive.append(node('summary', '', `最近のハンド (${recentHands.length}/10)`));
  const recordedStats = recentHands.filter((item) => item.outcome !== undefined && item.chipsChange !== undefined);
  const wins = recordedStats.filter((item) => item.outcome === 'win').length;
  const losses = recordedStats.filter((item) => item.outcome === 'loss').length;
  const draws = recordedStats.filter((item) => item.outcome === 'draw').length;
  const netChips = recordedStats.reduce((sum, item) => sum + (item.chipsChange ?? 0), 0);
  const winRate = recordedStats.length ? wins / recordedStats.length : null;
  const averageChange = recordedStats.length ? netChips / recordedStats.length : null;
  const stats = node('section', 'practice-stats');
  stats.append(node('h2', '', `練習戦績 · 直近10ハンド中${recordedStats.length}ハンドを集計`));
  stats.append(node('p', '', `勝ち ${wins} · 負け ${losses} · 引き分け ${draws}`));
  stats.append(node('p', '', `勝率 ${winRate === null ? '—' : `${(winRate * 100).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}%`}`));
  stats.append(node('p', '', `チップ増減 ${netChips > 0 ? '+' : ''}${formatChips(netChips)}`));
  stats.append(node('p', '', `1ハンド平均 ${averageChange === null ? '—' : `${averageChange > 0 ? '+' : ''}${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(averageChange)}`} チップ`));
  archive.append(stats);
  if (recentHands.length === 0) {
    archive.append(node('p', 'archive-empty', 'ハンドが終了すると、ここに結果が保存されます。'));
  } else {
    const archiveList = node('div', 'archive-list');
    for (const item of recentHands) {
      const entry = node('details', 'archive-entry');
      const date = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(item.completedAt));
      entry.append(node('summary', '', `ハンド ${item.handNumber} · ${date} · ${item.result}`));
      if (item.board.length) entry.append(node('p', 'archive-board', `ボード: ${item.board.join(' ')}`));
      const actions = node('ol', 'archive-actions');
      for (const action of item.actions) actions.append(node('li', '', action));
      entry.append(actions);
      archiveList.append(entry);
    }
    archive.append(archiveList);
    const clearButton = node('button', 'clear-archive', '履歴を消去');
    clearButton.type = 'button';
    clearButton.addEventListener('click', () => {
      recentHands = [];
      try { globalThis.localStorage.removeItem(handArchiveKey); } catch { /* Keep the in-memory archive cleared. */ }
      render();
    });
    archive.append(clearButton);
  }
  shell.append(archive);

  const identityStatus = guestIdentityOnlineReady
    ? 'ゲスト認証済み'
    : guestIdentityError ? 'ゲスト認証に接続できません。練習モードで動作中です。' : '端末内ゲスト';
  const footer = node('footer', 'footer-note', `${identityStatus} · 練習用テーブル · ゲーム内チップに金銭的価値はありません`);
  const references = node('nav', 'game-reference-links');
  references.setAttribute('aria-label', 'ポーカーガイド');
  references.append(pageLink('用語集', '/terms'), pageLink('役の強さ一覧', '/hands'), pageLink('トップ', '/'));
  shell.append(references);
  shell.append(footer);
  app!.replaceChildren(shell);
}

function stageLabel(stage: string): string {
  return ({ preflop: 'プリフロップ', flop: 'フロップ', turn: 'ターン', river: 'リバー', complete: 'ショーダウン' } as Record<string, string>)[stage] ?? stage;
}

if (sitePage === 'home') renderHomePage(app!, sitePage);
else if (sitePage === 'terms') renderTermsPage(app!, sitePage);
else if (sitePage === 'hands') renderHandsPage(app!, sitePage);
else void initializeGuestIdentity().then(({ guestId, onlineReady }) => {
  humanId = guestId;
  guestIdentityOnlineReady = onlineReady;
  if (sitePage === 'online') {
    const inviteId = window.location.hash.match(/^#room=([a-f0-9]{36})$/u)?.[1];
    appMode = 'online-lobby';
    if (inviteId) {
      onlineError = '';
      renderOnlineLobby();
      void joinOnlineRoom(inviteId);
    } else renderOnlineLobby();
  } else startGame();
}).catch(() => {
  // Keep practice available during an auth outage; online room actions will require a valid session.
  humanId = globalThis.crypto.randomUUID();
  guestIdentityError = true;
  if (sitePage === 'online') {
    appMode = 'online-lobby';
    onlineError = 'オンライン対戦に接続できません。Supabaseの設定と接続を確認してください。';
    renderOnlineLobby();
  } else startGame();
});
