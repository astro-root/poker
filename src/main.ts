import type { Card } from './poker/cards.ts';
import { applyTableAction, createTable, getPublicTableView, startNextHand, type TableState } from './poker/table.ts';
import { chooseAiAction } from './poker/ai.ts';
import { getHandPot } from './poker/hand.ts';
import { getLegalActions, type BettingAction } from './poker/betting.ts';
import { evaluateHand } from './poker/evaluator.ts';
import { explainHand, POKER_GLOSSARY } from './poker/education.ts';
import './style.css';

const humanId = globalThis.crypto.randomUUID();
const aiId = 'table-ai';
const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Application root is missing');

let table: TableState | null = null;
let aiTimer: number | undefined;
let aiThinking = false;
let notice = 'あなたの番です。合法なアクションを選んでください。';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatChips(amount: number): string {
  return new Intl.NumberFormat('ja-JP').format(amount);
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
    { id: aiId, stack: 1_000 },
  ], 5, 10);
  table = startNextHand(table);
  notice = 'あなたの番です。チェック、コール、レイズなどを選べます。';
  render();
}

function performAction(action: BettingAction): void {
  if (!table || !table.hand || table.hand.stage === 'complete' || aiThinking) return;
  try {
    table = applyTableAction(table, table.version, humanId, action);
    notice = actionNotice('あなた', action);
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
  if (!table?.hand || round?.actorId !== aiId || table.hand.stage === 'complete' || aiThinking) return;
  aiThinking = true;
  notice = '相手が考えています…';
  render();
  aiTimer = window.setTimeout(() => {
    if (!table?.hand?.bettingRound || table.hand.bettingRound.actorId !== aiId) {
      aiThinking = false;
      return;
    }
    const hand = table.hand;
    const player = hand.players.find((candidate) => candidate.id === aiId);
    if (!player || !hand.bettingRound) {
      aiThinking = false;
      return;
    }
    try {
      const action = chooseAiAction({
        playerId: aiId,
        holeCards: player.holeCards,
        board: hand.board,
        legalActions: getLegalActions(hand.bettingRound, aiId),
        stack: player.stack,
        pot: getHandPot(hand),
        streetContribution: player.streetContribution,
        currentBet: hand.bettingRound.currentBet,
      });
      table = applyTableAction(table, table.version, aiId, action);
      notice = actionNotice('相手', action);
    } catch (error) {
      notice = error instanceof Error ? error.message : '相手の操作を反映できませんでした。';
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
  header.append(brand, node('span', 'practice-tag', '練習テーブル'));
  shell.append(header);

  const intro = node('section', 'intro');
  intro.append(node('div', 'eyebrow', 'TEXAS HOLD’EM / TABLE 01'));
  intro.append(node('h1', '', '一手ずつ、覚えていこう。'));
  intro.append(node('p', 'intro-copy', 'ルールベースAIとの練習対戦です。チップはゲーム内の練習用です。'));
  shell.append(intro);

  const tableCard = node('section', 'game-panel');
  const panelHeader = node('div', 'panel-header');
  panelHeader.append(node('span', 'panel-label', `ハンド ${table.handNumber} · ${stageLabel(hand.stage)}`));
  panelHeader.append(node('span', `turn-indicator${isHumanTurn ? ' your-turn' : ''}`, hand.stage === 'complete' ? 'ハンド終了' : isHumanTurn ? 'あなたの番' : aiThinking ? '相手の思考中' : '進行中'));
  tableCard.append(panelHeader);

  const felt = node('div', 'felt');
  const opponent = view.hand?.players.find((player) => player.id === aiId);
  const opponentSeat = renderSeat('AIプレイヤー', opponent, aiId === round?.actorId, false);
  felt.append(opponentSeat);

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
  felt.append(renderSeat('あなた', human, isHumanTurn, true));
  tableCard.append(felt);

  const noticeBar = node('div', 'notice-bar');
  noticeBar.append(node('span', 'notice-dot'), node('span', '', notice));
  tableCard.append(noticeBar);
  shell.append(tableCard);

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
      const winners = Object.entries(result.settlement.payouts).filter(([, amount]) => amount > 0).map(([id, amount]) => `${id === humanId ? 'あなた' : '相手'} +${formatChips(amount)}`).join('　');
      actionPanel.append(node('p', 'result-copy', winners || 'ショーダウンが終了しました。'));
    } else if (result?.type === 'uncontested') {
      actionPanel.append(node('p', 'result-copy', `${result.winnerId === humanId ? 'あなた' : '相手'}が全員のフォールドでポット ${formatChips(result.pot)} を獲得しました。`));
    }
    const canContinue = table.seats.filter((seat) => seat.stack > 0).length >= 2;
    const nextButton = createActionButton(canContinue ? '次のハンドへ' : '最初から遊ぶ', { type: 'check' }, 'primary-action', false);
    nextButton.addEventListener('click', () => {
      try {
        if (canContinue) table = startNextHand(table!);
        else startGame();
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
    actionPanel.append(node('p', 'action-hint', `${callInfo} · ポット ${formatChips(view.hand?.pot ?? 0)} · 最小レイズ ${formatChips(legal.minRaiseTo)}`));
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

  const footer = node('footer', 'footer-note', '練習用テーブル · ゲーム内チップに金銭的価値はありません');
  shell.append(footer);
  app!.replaceChildren(shell);
}

function renderSeat(name: string, seat: { id: string; stack: number; folded: boolean; holeCards: readonly [Card, Card] | null; streetContribution: number } | undefined, active: boolean, showCards: boolean): HTMLElement {
  const card = node('div', `player-seat${active ? ' active-seat' : ''}${seat?.folded ? ' folded-seat' : ''}${showCards ? ' human-seat' : ''}`);
  const avatar = node('span', 'avatar', showCards ? 'YOU' : 'AI');
  const details = node('div', 'seat-details');
  details.append(node('strong', '', name));
  details.append(node('span', 'seat-stack', `${formatChips(seat?.stack ?? 0)} チップ`));
  if (seat && seat.streetContribution > 0) details.append(node('span', 'seat-bet', `ベット ${formatChips(seat.streetContribution)}`));
  card.append(avatar, details);
  const cards = node('div', 'card-row hole-cards');
  const holeCards = seat?.holeCards;
  cards.append(cardElement(holeCards?.[0] ?? null, !showCards || !holeCards));
  cards.append(cardElement(holeCards?.[1] ?? null, !showCards || !holeCards));
  card.append(cards);
  if (seat?.folded) card.append(node('span', 'folded-label', 'フォールド'));
  if (active) card.append(node('span', 'seat-turn-label', 'アクション中'));
  return card;
}

function stageLabel(stage: string): string {
  return ({ preflop: 'プリフロップ', flop: 'フロップ', turn: 'ターン', river: 'リバー', complete: 'ショーダウン' } as Record<string, string>)[stage] ?? stage;
}

startGame();
