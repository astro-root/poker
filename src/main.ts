import type { Card } from './poker/cards.ts';
import { applyTableAction, createTable, getPublicTableView, startNextHand, type TableState } from './poker/table.ts';
import { chooseAiAction, type AiStyle } from './poker/ai.ts';
import { getHandPot } from './poker/hand.ts';
import { getLegalActions, type BettingAction } from './poker/betting.ts';
import { evaluateHand } from './poker/evaluator.ts';
import { explainHand, getCallBreakEvenProbability, POKER_GLOSSARY } from './poker/education.ts';
import './style.css';

const humanId = globalThis.crypto.randomUUID();
const aiIds = Array.from({ length: 9 }, (_, index) => `table-ai-${index + 1}`);
const opponentCountOptions = [1, 3, 5] as const;
const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Application root is missing');

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

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatChips(amount: number): string {
  return new Intl.NumberFormat('ja-JP').format(amount);
}

function isAiPlayer(id: string): boolean {
  return aiIds.includes(id);
}

function aiStyle(id: string): AiStyle {
  const index = aiIds.indexOf(id);
  return index === 0 ? 'aggressive' : index === 2 ? 'cautious' : 'balanced';
}

function playerLabel(id: string): string {
  if (id === humanId) return playerName;
  const index = aiIds.indexOf(id);
  const style = index === 0 ? '攻め' : index === 2 ? '堅実' : '標準';
  return index >= 0 ? `AI ${index + 1} · ${style}` : 'プレイヤー';
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
  const humanFinalStack = hand.players.find((player) => player.id === humanId)?.stack ?? humanStackAtHandStart;
  const chipsChange = humanFinalStack - humanStackAtHandStart;
  const outcome: ArchivedHand['outcome'] = chipsChange > 0 ? 'win' : chipsChange < 0 ? 'loss' : 'draw';
  recentHands = [{
    handNumber: table.handNumber,
    completedAt: new Date().toISOString(),
    actions: [...handHistory],
    board: hand.board.map(cardLabel),
    result,
    outcome,
    chipsChange,
  }, ...recentHands].slice(0, 10);
  try { globalThis.localStorage.setItem(handArchiveKey, JSON.stringify(recentHands)); } catch { /* Keep the in-memory summary if storage is unavailable. */ }
}

function cardLabel(card: Card): string {
  const rank = card.rank <= 10 ? String(card.rank) : ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[card.rank];
  const suit = ({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' } as const)[card.suit];
  return `${rank}${suit}`;
}

function cardElement(card: Card | null, hidden = false): HTMLElement {
  if (hidden || !card) {
    const back = node('span', 'playing-card card-back', '✦');
    back.setAttribute('aria-label', '非公開のカード');
    return back;
  }
  const red = card.suit === 'hearts' || card.suit === 'diamonds';
  const face = node('span', `playing-card${red ? ' red-suit' : ''}`);
  face.setAttribute('aria-label', cardLabel(card));
  face.append(node('span', 'card-rank', cardLabel(card).slice(0, -1)));
  face.append(node('span', 'card-suit', cardLabel(card).slice(-1)));
  return face;
}

function startGame(): void {
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
  notice = 'あなたの番です。チェック、コール、レイズなどを選べます。';
  render();
  runAiIfNeeded();
}

function performAction(action: BettingAction): void {
  if (!table || !table.hand || table.hand.stage === 'complete' || aiThinking) return;
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

function createActionButton(label: string, action: BettingAction, style: string, disabled: boolean): HTMLButtonElement {
  const button = node('button', `action-button ${style}`, label);
  button.type = 'button';
  button.disabled = disabled;
  button.addEventListener('click', () => performAction(action));
  return button;
}

function render(): void {
  if (!table?.hand) return;
  archiveCompletedHand();
  const view = getPublicTableView(table, humanId);
  const hand = table.hand;
  const me = hand.players.find((player) => player.id === humanId);
  const round = hand.bettingRound;
  const isHumanTurn = !aiThinking && round?.actorId === humanId && hand.stage !== 'complete';
  const legal = isHumanTurn && round ? getLegalActions(round, humanId) : null;
  const shell = node('main', 'page-shell');

  const header = node('header', 'topbar');
  const brand = node('a', 'brand', 'POKER TABLE');
  brand.href = '/';
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
  header.append(brand, playerControl, node('span', 'practice-tag', '練習テーブル'));
  shell.append(header);

  const intro = node('section', 'intro');
  intro.append(node('div', 'eyebrow', 'TEXAS HOLD’EM / TABLE 01'));
  intro.append(node('h1', '', '一手ずつ、覚えていこう。'));
  intro.append(node('p', 'intro-copy', '攻め・標準・堅実の3人のルールベースAIとの練習対戦です。チップはゲーム内の練習用です。'));
  shell.append(intro);
  const beginnerGuide = node('details', 'beginner-guide');
  beginnerGuide.append(node('summary', '', 'はじめての方へ：遊び方を見る'));
  const guideBody = node('div', 'guide-body');
  guideBody.append(node('p', '', '手札2枚と、テーブル中央に順番に出る共通カード5枚から、いちばん強い5枚の役を作ります。'));
  guideBody.append(node('p', '', '自分の番では、チェック（追加せず進む）、コール（相手に合わせる）、レイズ（ベットを上げる）、フォールド（そのハンドを降りる）などを選びます。'));
  guideBody.append(node('p', '', 'ほかのプレイヤーより多くのチップを獲得することを目指します。練習チップに金銭的価値はなく、この画面の対戦状態は端末内だけで管理されます。'));
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
  shell.append(tableSettings);

  const tableCard = node('section', 'game-panel');
  const panelHeader = node('div', 'panel-header');
  panelHeader.append(node('span', 'panel-label', `ハンド ${table.handNumber} · ${stageLabel(hand.stage)}`));
  panelHeader.append(node('span', `turn-indicator${isHumanTurn ? ' your-turn' : ''}`, hand.stage === 'complete' ? 'ハンド終了' : isHumanTurn ? 'あなたの番' : aiThinking ? '相手の思考中' : '進行中'));
  tableCard.append(panelHeader);

  const felt = node('div', 'felt');
  const opponents = node('div', 'opponent-seats');
  for (const opponent of (view.hand?.players ?? []).filter((player) => player.id !== humanId)) {
    opponents.append(renderSeat(playerLabel(opponent.id), opponent, opponent.id === round?.actorId, false, table.buttonPlayerId === opponent.id, Boolean(opponent.holeCards)));
  }
  felt.append(opponents);

  const center = node('div', 'table-center');
  center.append(node('div', 'pot-label', 'POT'));
  const potValue = node('div', 'pot-value');
  potValue.append(document.createTextNode(formatChips(view.hand?.pot ?? 0)), node('small', '', ' CHIPS'));
  center.append(potValue);
  const board = node('div', 'card-row community-cards');
  const boardCards = view.hand?.board ?? [];
  for (let index = 0; index < 5; index++) board.append(cardElement(boardCards[index] ?? null, !boardCards[index]));
  center.append(board);
  felt.append(center);

  const human = view.hand?.players.find((player) => player.id === humanId);
  felt.append(renderSeat(playerName, human, isHumanTurn, true, table.buttonPlayerId === humanId));
  tableCard.append(felt);

  const noticeBar = node('div', 'notice-bar');
  noticeBar.setAttribute('role', 'status');
  noticeBar.setAttribute('aria-live', 'polite');
  noticeBar.append(node('span', 'notice-dot'), node('span', '', notice));
  tableCard.append(noticeBar);
  shell.append(tableCard);

  const historyDetails = node('details', 'hand-history');
  const historySummary = node('summary', '', `このハンドの履歴 (${handHistory.length})`);
  historyDetails.append(historySummary);
  const historyList = node('ol', 'history-list');
  if (handHistory.length === 0) historyList.append(node('li', 'history-empty', '最初のアクション後にここへ記録されます。'));
  else for (const event of handHistory) historyList.append(node('li', '', event));
  historyDetails.append(historyList);
  shell.append(historyDetails);

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
    shell.append(lesson);
  } else if (hand.stage !== 'complete') {
    shell.append(node('div', 'lesson-placeholder', 'フロップが公開されると、現在成立している役と構成カードをここに表示します。'));
  }

  const actionPanel = node('section', 'action-panel');
  const actionHeading = node('div', 'action-heading');
  actionHeading.append(node('h2', '', hand.stage === 'complete' ? '次のハンド' : 'あなたのアクション'));
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
    const canContinue = (table.seats.find((seat) => seat.id === humanId)?.stack ?? 0) > 0
      && table.seats.filter((seat) => seat.stack > 0).length >= 2;
    const nextButton = node('button', 'action-button primary-action', canContinue ? '次のハンドへ' : '最初から遊ぶ');
    nextButton.type = 'button';
    nextButton.addEventListener('click', () => {
      try {
        if (canContinue) {
          humanStackAtHandStart = table!.seats.find((seat) => seat.id === humanId)?.stack ?? 0;
          table = startNextHand(table!);
          handHistory = [];
          archivedHand = null;
        } else startGame();
        notice = 'あなたの番です。';
        render();
        runAiIfNeeded();
      } catch {
        startGame();
      }
    });
    actionPanel.append(nextButton);
  } else if (legal && me) {
    const actions = node('div', 'action-grid');
    actions.append(createActionButton('フォールド', { type: 'fold' }, 'fold-action', !legal.canFold));
    if (legal.canCheck) actions.append(createActionButton('チェック', { type: 'check' }, 'secondary-action', false));
    else actions.append(createActionButton(`コール ${formatChips(legal.callAmount)}`, { type: 'call' }, 'secondary-action', legal.callAmount === 0));
    if (legal.canRaise) {
      const wager = node('div', 'wager-control');
      const range = node('input', 'wager-range') as HTMLInputElement;
      range.type = 'range';
      range.min = String(Math.min(legal.minRaiseTo, legal.maxRaiseTo));
      range.max = String(legal.maxRaiseTo);
      range.value = range.min;
      range.setAttribute('aria-label', 'ベットまたはレイズ額');
      const amount = node('output', 'wager-amount', formatChips(Number(range.value)));
      range.addEventListener('input', () => { amount.textContent = formatChips(Number(range.value)); });
      const wagerButton = node('button', 'action-button primary-action', `${round!.currentBet === 0 ? 'ベット' : 'レイズ'} ${amount.textContent}`);
      wagerButton.type = 'button';
      range.addEventListener('input', () => { wagerButton.textContent = `${round!.currentBet === 0 ? 'ベット' : 'レイズ'} ${formatChips(Number(range.value))}`; });
      wagerButton.disabled = aiThinking;
      wagerButton.addEventListener('click', () => {
        const target = Number(range.value);
        performAction(target === legal.maxRaiseTo && target < legal.minRaiseTo
          ? { type: 'all-in' }
          : { type: round!.currentBet === 0 ? 'bet' : 'raise', to: target });
      });
      wager.append(amount, range, wagerButton);
      actions.append(wager);
    }
    const canMoveAllIn = legal.canRaise || me.stack <= legal.callAmount;
    if (me.stack > 0 && canMoveAllIn) actions.append(createActionButton('オールイン', { type: 'all-in' }, 'allin-action', false));
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
  } else {
    actionPanel.append(node('p', 'action-hint', '相手がアクションしています。'));
  }
  shell.append(actionPanel);

  const glossary = node('details', 'glossary');
  const summary = node('summary', '', '用語を確認する');
  glossary.append(summary);
  const glossaryGrid = node('div', 'glossary-grid');
  for (const entry of POKER_GLOSSARY) {
    const definition = node('div', 'glossary-entry');
    definition.append(node('strong', '', entry.term), node('p', '', entry.explanation));
    glossaryGrid.append(definition);
  }
  glossary.append(glossaryGrid);
  shell.append(glossary);

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

  const footer = node('footer', 'footer-note', '練習用テーブル · ゲーム内チップに金銭的価値はありません');
  shell.append(footer);
  app!.replaceChildren(shell);
}

function renderSeat(name: string, seat: { id: string; stack: number; folded: boolean; holeCards: readonly [Card, Card] | null; streetContribution: number } | undefined, active: boolean, showCards: boolean, isDealer: boolean, revealOpponentCards = false): HTMLElement {
  const card = node('div', `player-seat${active ? ' active-seat' : ''}${seat?.folded ? ' folded-seat' : ''}${showCards ? ' human-seat' : ''}`);
  const avatar = node('span', 'avatar', showCards ? 'YOU' : 'AI');
  const details = node('div', 'seat-details');
  details.append(node('strong', '', name));
  details.append(node('span', 'seat-stack', `${formatChips(seat?.stack ?? 0)} チップ`));
  if (seat && seat.streetContribution > 0) details.append(node('span', 'seat-bet', `ベット ${formatChips(seat.streetContribution)}`));
  card.append(avatar, details);
  if (isDealer) card.append(node('span', 'dealer-button', 'D'));
  const cards = node('div', 'card-row hole-cards');
  const holeCards = seat?.holeCards;
  const cardsVisible = showCards || revealOpponentCards;
  cards.append(cardElement(holeCards?.[0] ?? null, !cardsVisible || !holeCards));
  cards.append(cardElement(holeCards?.[1] ?? null, !cardsVisible || !holeCards));
  card.append(cards);
  if (seat?.folded) card.append(node('span', 'folded-label', 'フォールド'));
  if (active) card.append(node('span', 'seat-turn-label', 'アクション中'));
  return card;
}

function stageLabel(stage: string): string {
  return ({ preflop: 'プリフロップ', flop: 'フロップ', turn: 'ターン', river: 'リバー', complete: 'ショーダウン' } as Record<string, string>)[stage] ?? stage;
}

startGame();
