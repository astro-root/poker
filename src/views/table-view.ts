import { AI_LEVEL_LABELS } from '../poker/ai.ts';
import { getLegalActions, type BettingAction, type BettingRound, type LegalActions } from '../poker/betting.ts';
import { evaluateHand } from '../poker/evaluator.ts';
import { explainHand, getCallBreakEvenProbability } from '../poker/education.ts';
import { getPublicTableView } from '../poker/table.ts';
import { formatChips, node } from '../ui/dom.ts';
import { cardElement, emptyCardSlot } from '../ui/components/card.ts';
import { createActionButton } from '../ui/components/action-button.ts';
import { renderSeat } from '../ui/components/seat.ts';
import { SITE_NAME, siteFooter, siteHeader } from '../ui/header.ts';
import {
  archiveCompletedHand, clearArchive, hooks, isAiPlayer, playerLabel, stageLabel, store,
} from '../app/state.ts';
import { coachAdvice, currentEquity, formatPercent } from '../app/coach.ts';
import { backToSetup, continueToNextHand, performAction } from '../app/practice.ts';
import { closeOnlineSession, renameSelf, requestNextOnlineHand, requestRematch } from '../app/online.ts';
import type { HandActionRecord } from '../poker/hand.ts';
import { openHostSettings } from './lobby-view.ts';
import { iconButton, iconLink } from '../ui/icons.ts';

const online = store.online;

/** Positions n opponents evenly around an ellipse with the player fixed at the bottom ("手前"). */
export function ringPosition(index: number, opponentCount: number): { x: number; y: number } {
  const angle = (90 + ((index + 1) * 360) / (opponentCount + 1)) * (Math.PI / 180);
  return { x: 50 + 40 * Math.cos(angle), y: 50 + 35 * Math.sin(angle) };
}

function chip(label: string, value: string, modifier = ''): HTMLElement {
  const el = node('span', `stat-chip${modifier ? ` ${modifier}` : ''}`);
  el.append(node('span', 'stat-label', label), node('strong', 'stat-value', value));
  return el;
}

function details(summary: string, className: string, open = false): HTMLDetailsElement {
  const element = node('details', className);
  element.open = open;
  element.append(node('summary', '', summary));
  return element;
}

/** Whether the player may see the name of their own current hand (a host option online; always on in practice). */
function rankVisible(): boolean { return store.mode !== 'online-playing' || online.settings.showHandRank; }

export function describeAction(record: HandActionRecord): string {
  switch (record.type) {
    case 'fold': return 'フォールド';
    case 'check': return 'チェック';
    case 'call': return record.allIn ? `コール ${formatChips(record.amount)}（オールイン）` : `コール ${formatChips(record.amount)}`;
    case 'bet': return record.allIn ? `ベット ${formatChips(record.total)}（オールイン）` : `ベット ${formatChips(record.total)}`;
    case 'raise': return record.allIn ? `レイズ ${formatChips(record.total)}（オールイン）` : `レイズ ${formatChips(record.total)}`;
    default: return `オールイン ${formatChips(record.total)}`;
  }
}

/** Remembers how many community cards the previous render showed (animation only; never game state). */
let lastBoard = { handNumber: -1, count: 0 };

export function renderPlayView(app: HTMLElement): void {
  const table = store.table;
  if (!table?.hand) return;
  archiveCompletedHand();
  const isOnline = store.mode === 'online-playing';
  const hand = table.hand;
  const view = getPublicTableView(table, store.humanId);
  const round = hand.bettingRound;
  const me = hand.players.find((player) => player.id === store.humanId);
  const humanTurn = !store.aiThinking && round?.actorId === store.humanId && hand.stage !== 'complete';
  const legal = humanTurn && round ? getLegalActions(round, store.humanId) : null;
  const pot = view.hand?.pot ?? 0;
  document.title = `${isOnline ? 'オンライン対戦' : 'AI対戦'} — ${SITE_NAME}`;

  const shell = node('div', 'page-shell play-page');
  shell.append(siteHeader(isOnline ? 'online' : 'ai'));
  const main = node('main', 'play');
  const layout = node('div', 'play-layout');
  const stage = node('div', 'play-main');

  // ── status bar
  const level = table.escalateBlinds === false ? 1 : Math.floor((table.handNumber - 1) / 10) + 1;
  const statusBar = node('div', 'table-status');
  const meta = node('div', 'status-meta');
  meta.append(node('span', 'status-hand', table.maxHands ? `ハンド ${table.handNumber} / ${table.maxHands}` : `ハンド ${table.handNumber}`), node('span', 'status-stage', stageLabel(hand.stage)),
    node('span', 'status-blinds', `${table.escalateBlinds === false ? '' : `Lv.${level} · `}SB ${formatChips(table.smallBlind)} / BB ${formatChips(table.bigBlind)}${table.ante > 0 ? ` · アンティ ${formatChips(table.ante)}` : ''}`));
  if (isOnline && online.role === 'spectator') meta.append(node('span', 'status-opponents', '観戦中'));
  else if (isOnline && online.spectators.some((peer) => peer.connected)) meta.append(node('span', 'status-opponents', `観戦 ${online.spectators.filter((peer) => peer.connected).length}人`));
  if (!isOnline) meta.append(node('span', 'status-opponents', `${AI_LEVEL_LABELS[store.ai.level]} · AI ${store.ai.count}人`));
  const actorId = round?.actorId;
  const turnText = hand.stage === 'complete' ? 'ハンド終了' : humanTurn ? 'あなたの番です' : store.aiThinking ? '相手が考え中' : actorId ? `${playerLabel(actorId)}の番` : '進行中';
  const turn = node('span', `turn-badge${humanTurn ? ' is-you' : ''}`, turnText);
  turn.setAttribute('role', 'status');
  statusBar.append(meta, turn);
  const controls = node('div', 'status-controls');
  if (isOnline) {
    const info = iconLink('info', 'ルーム情報', `/online#room=${online.roomId}`);
    const leave = iconButton('leave', '退出', 'button-danger-ghost');
    leave.title = online.role === 'spectator' ? '観戦をやめます' : '退出するとこのハンドはフォールドになり、席は離席扱いになります';
    leave.addEventListener('click', () => {
      if (online.role !== 'spectator' && !window.confirm('退出するとこのハンドはフォールドになり、離席扱いになります。退出しますか？')) return;
      void closeOnlineSession().finally(() => { window.location.assign('/online'); });
    });
    controls.append(info, renameButton());
    if (online.host) {
      const settings = iconButton('settings', 'ルーム設定');
      settings.addEventListener('click', openHostSettings);
      controls.append(settings);
    }
    controls.append(leave);
  } else {
    // Changing the name in place keeps the game running; "設定を変更" goes back to setup and starts a NEW game.
    const setup = iconButton('settings', '設定を変更（新しいゲーム）');
    setup.addEventListener('click', () => {
      if (window.confirm('設定を変更すると、現在のゲームは終了して新しいゲームになります。よろしいですか？')) backToSetup();
    });
    controls.append(renameButton(), setup);
  }
  statusBar.append(controls);
  stage.append(statusBar);

  // ── felt
  const feltWrap = node('div', 'felt-wrap');
  const felt = node('div', 'felt');
  felt.append(node('div', 'felt-oval'));
  const largest = Math.max(1, ...(view.hand?.players.map((player) => player.stack) ?? []));
  const orderIndex = hand.players.findIndex((player) => player.id === store.humanId);
  const ordered = orderIndex < 0 ? [...hand.players] : [...hand.players.slice(orderIndex + 1), ...hand.players.slice(0, orderIndex)];
  const winners = new Set(hand.result?.type === 'uncontested' ? [hand.result.winnerId]
    : hand.result?.type === 'showdown' ? Object.entries(hand.result.settlement.payouts).filter(([, amount]) => amount > 0).map(([id]) => id) : []);
  const opponentIds = ordered.filter((player) => player.id !== store.humanId);
  const seats = node('div', 'seats');
  const n = opponentIds.length;
  seats.style.setProperty('--cols', String(n <= 3 ? Math.max(1, n) : n === 4 ? 2 : n <= 6 ? 3 : 4));
  const actionLog = hand.actionLog ?? [];
  const lastActionOf = (id: string): string | undefined => { for (let i = actionLog.length - 1; i >= 0; i--) if (actionLog[i]!.playerId === id) return describeAction(actionLog[i]!); return undefined; };
  const publicPlayers = new Map((view.hand?.players ?? []).map((player) => [player.id, player]));
  opponentIds.forEach((player, index) => {
    const publicPlayer = publicPlayers.get(player.id)!;
    const peer = online.peers.find((candidate) => candidate.id === player.id);
    const wrapper = node('div', 'seat-slot');
    const pos = ringPosition(index, opponentIds.length);
    wrapper.style.setProperty('--x', `${pos.x.toFixed(2)}%`);
    wrapper.style.setProperty('--y', `${pos.y.toFixed(2)}%`);
    wrapper.append(renderSeat({
      name: playerLabel(player.id),
      kind: isAiPlayer(player.id) ? 'ai' : 'player',
      tag: isAiPlayer(player.id) ? AI_LEVEL_LABELS[store.ai.level] : undefined,
      stack: publicPlayer.stack, stackRatio: publicPlayer.stack / largest, bet: publicPlayer.streetContribution,
      folded: publicPlayer.folded, allIn: !publicPlayer.folded && publicPlayer.stack === 0 && hand.stage !== 'complete',
      active: player.id === actorId && hand.stage !== 'complete', dealer: table.buttonPlayerId === player.id,
      away: isOnline && peer !== undefined && !peer.connected,
      holeCards: publicPlayer.holeCards, showCards: Boolean(publicPlayer.holeCards), winner: winners.has(player.id) && hand.stage === 'complete',
      lastAction: lastActionOf(player.id),
    }));
    seats.append(wrapper);
  });
  const heroPublic = publicPlayers.get(store.humanId);
  const heroSlot = node('div', 'seat-slot seat-slot-hero');
  heroSlot.style.setProperty('--x', '50%');
  heroSlot.style.setProperty('--y', '85%');
  heroSlot.append(renderSeat({
    name: store.playerName, kind: 'you', stack: heroPublic?.stack ?? 0, stackRatio: (heroPublic?.stack ?? 0) / largest,
    bet: heroPublic?.streetContribution ?? 0, folded: heroPublic?.folded ?? false,
    allIn: Boolean(heroPublic && !heroPublic.folded && heroPublic.stack === 0 && hand.stage !== 'complete'),
    active: humanTurn, dealer: table.buttonPlayerId === store.humanId, holeCards: null, showCards: false,
    winner: winners.has(store.humanId) && hand.stage === 'complete', lastAction: lastActionOf(store.humanId),
  }));
  seats.append(heroSlot);
  felt.append(seats);

  const center = node('div', 'table-center');
  const potBox = node('div', 'pot');
  potBox.append(node('span', 'pot-label', 'POT'), node('strong', 'pot-value', formatChips(pot)));
  center.append(potBox);
  const board = node('div', 'board');
  const boardCards = view.hand?.board ?? [];
  // Only cards that were not on the board at the previous render animate, so re-renders never replay the reveal.
  const sameHand = lastBoard.handNumber === table.handNumber;
  const alreadyShown = sameHand ? lastBoard.count : 0;
  for (let index = 0; index < 5; index++) {
    const card = boardCards[index];
    if (!card) { board.append(emptyCardSlot('md')); continue; }
    const element = cardElement(card, false, 'md');
    if (index >= alreadyShown && sameHand) element.classList.add('deal-in');
    board.append(element);
  }
  lastBoard = { handNumber: table.handNumber, count: boardCards.length };
  center.append(board);
  const equity = currentEquity();
  if (equity) {
    const strip = node('div', 'equity');
    strip.title = `${equity.samples}回のシミュレーションによる推定値です`;
    strip.append(chip('勝率', `${formatPercent(equity.win)}%`), chip('引き分け', `${formatPercent(equity.tie)}%`));
    center.append(strip);
  }
  felt.append(center);
  feltWrap.append(felt);
  stage.append(feltWrap);

  const latest = actionLog[actionLog.length - 1];
  const recent = node('p', 'last-action');
  recent.setAttribute('aria-live', 'polite');
  if (latest) recent.append(node('strong', '', `${playerLabel(latest.playerId)}${latest.playerId === store.humanId ? '' : ''}`), document.createTextNode(` が ${describeAction(latest)}`));
  else recent.textContent = hand.stage === 'complete' ? '' : 'ブラインドを払ってハンドが始まりました。';
  stage.append(recent);

  const noticeBar = node('div', `notice${online.error ? ' is-error' : ''}`);
  noticeBar.setAttribute('role', 'status');
  noticeBar.setAttribute('aria-live', 'polite');
  noticeBar.append(node('span', 'notice-dot'), node('span', 'notice-text', online.error || store.notice));
  stage.append(noticeBar);

  if (hand.stage === 'complete') stage.append(renderResult());

  // ── dock
  const dock = renderDock({ legal, humanTurn, pot, round: round ?? null });

  // ── info
  const info = renderInfo({ legal, equity, pot });
  layout.append(stage, dock, info);
  main.append(layout);
  shell.append(main, siteFooter());
  app.replaceChildren(shell);
}

function renderResult(): HTMLElement {
  const hand = store.table!.hand!;
  const view = getPublicTableView(store.table!, store.humanId);
  const panel = node('section', 'result');
  panel.append(node('span', 'eyebrow', 'RESULT'));
  const result = hand.result;
  if (result?.type === 'showdown') {
    const payouts = Object.entries(result.settlement.payouts).filter(([, amount]) => amount > 0);
    panel.append(node('h2', 'result-title', payouts.map(([id, amount]) => `${playerLabel(id)} +${formatChips(amount)}`).join('　') || 'ショーダウン'));
    const reveal = node('div', 'revealed');
    for (const [id, evaluated] of Object.entries(result.settlement.hands)) {
      const item = node('div', `revealed-hand${payouts.some(([winner]) => winner === id) ? ' is-winner' : ''}`);
      item.append(node('strong', '', playerLabel(id)), node('span', 'revealed-name', explainHand(evaluated).name));
      const cards = node('div', 'card-row');
      const player = view.hand?.players.find((candidate) => candidate.id === id);
      if (player?.holeCards) for (const card of player.holeCards) cards.append(cardElement(card, false, 'sm'));
      item.append(cards);
      reveal.append(item);
    }
    panel.append(reveal);
    const potList = node('ul', 'pot-results');
    result.settlement.pots.forEach((pot, index) => {
      potList.append(node('li', '', `${index === 0 ? 'メインポット' : `サイドポット ${index}`} · ${formatChips(pot.amount)} チップ · ${pot.winnerIds.map(playerLabel).join('・')}が獲得`));
    });
    panel.append(potList);
  } else if (result?.type === 'uncontested') {
    panel.append(node('h2', 'result-title', `${playerLabel(result.winnerId)}が ${formatChips(result.pot)} チップを獲得`), node('p', 'result-sub', '全員がフォールドしたため、手札は公開されません。'));
  }
  if (result?.returned) panel.append(node('p', 'result-sub', `未コール分 ${formatChips(result.returned.amount)} チップを${playerLabel(result.returned.playerId)}へ返却しました。`));
  if (online.winnerId) panel.append(node('p', 'result-champion', `🏆 ${playerLabel(online.winnerId)}がこの対戦に優勝しました。`));
  else if (online.finished) panel.append(node('p', 'result-champion', '対戦が終了しました（同点）。'));
  return panel;
}

type DockArgs = Readonly<{ legal: LegalActions | null; humanTurn: boolean; pot: number; round: BettingRound | null }>;

/** Renames the player without touching the game: online it goes through the server, offline it only changes the label. */
function renameButton(): HTMLButtonElement {
  const rename = iconButton('rename', '名前を変更');
  rename.addEventListener('click', () => {
    const next = window.prompt('新しい表示名（20文字以内）', store.playerName);
    if (next !== null) renameSelf(next);
  });
  return rename;
}

function renderDock(args: DockArgs): HTMLElement {
  const table = store.table!;
  const hand = table.hand!;
  const isOnline = store.mode === 'online-playing';
  const { legal, humanTurn, pot, round } = args;
  const me = hand.players.find((player) => player.id === store.humanId);
  if (isOnline && online.role === 'spectator') {
    const watch = node('section', 'dock dock-spectator');
    watch.setAttribute('aria-label', '観戦中');
    watch.append(node('strong', 'hero-name', '観戦中'), node('p', 'dock-waiting', '観戦者は手札を見ることも、操作することもできません。'));
    if (hand.stage === 'complete' && online.finished) watch.append(node('p', 'dock-waiting', '対戦が終了しました。プレイヤーの再戦をお待ちください。'));
    return watch;
  }
  if (!humanTurn) store.allInArmed = false;
  const dock = node('section', `dock${humanTurn ? ' is-your-turn' : ''}${store.raiseOpen && legal?.canRaise ? ' raise-open' : ''}`);
  dock.setAttribute('aria-label', 'あなたの手札と操作');

  // A-1: the player's hole cards are their own large element — never squeezed into the seat card.
  const handBox = node('div', 'dock-hand');
  const hero = node('div', `hero-cards${me?.folded ? ' is-folded' : ''}`);
  if (me) for (const card of me.holeCards) hero.append(cardElement(card, false, 'lg'));
  else hero.append(emptyCardSlot('lg'), emptyCardSlot('lg'));
  const heroMeta = node('div', 'hero-meta');
  heroMeta.append(node('strong', 'hero-name', store.playerName), node('span', 'hero-stack', me ? `残り ${formatChips(me.stack)} チップ` : '次のハンドから参加します'));
  if (me && rankVisible() && hand.board.length >= 3 && hand.stage !== 'complete' && !me.folded) {
    const explanation = explainHand(evaluateHand([...me.holeCards, ...hand.board]));
    const made = node('span', 'hero-made');
    made.append(node('span', 'hero-made-label', '現在の役'), node('strong', '', explanation.name));
    heroMeta.append(made);
  } else if (me?.folded) heroMeta.append(node('span', 'hero-made', 'フォールド済み'));
  handBox.append(hero, heroMeta);
  dock.append(handBox);

  const actions = node('div', 'dock-actions');
  const pending = isOnline && online.pending;
  if (hand.stage === 'complete') {
    if (isOnline && online.finished) {
      const rematch = node('button', 'button button-primary button-large', 'リマッチする');
      rematch.type = 'button';
      rematch.disabled = pending;
      rematch.addEventListener('click', requestRematch);
      actions.append(rematch);
    } else {
      const canContinue = (table.seats.find((seat) => seat.id === store.humanId)?.stack ?? 0) > 0 && table.seats.filter((seat) => seat.stack > 0).length >= 2;
      const present = !isOnline || online.peers.some((peer) => peer.id === store.humanId && peer.connected);
      const next = node('button', 'button button-primary button-large', canContinue ? '次のハンドへ' : isOnline ? '次のハンドを開始できません' : '新しいゲームを始める');
      next.type = 'button';
      next.disabled = pending || (isOnline && !(present && canContinue));
      next.dataset.shortcut = 'n';
      next.setAttribute('aria-keyshortcuts', 'N');
      next.addEventListener('click', () => { if (isOnline) requestNextOnlineHand(); else continueToNextHand(); });
      actions.append(next);
    }
  } else if (legal && round && me) {
    actions.append(...renderActionControls(legal, round.currentBet, me.stack, pot, pending));
  } else {
    // The panel never disappears: out of turn the same controls stay in place, greyed out and not pressable.
    const who = round?.actorId ? `${playerLabel(round.actorId)}の番です` : '';
    const note = me?.folded ? 'このハンドは終了しました。次のハンドをお待ちください。' : who || 'ほかのプレイヤーの手番です。';
    actions.append(...renderIdleControls(pot, note));
  }
  dock.append(actions);
  return dock;
}

function renderIdleControls(pot: number, note: string): HTMLElement[] {
  const stats = node('div', 'dock-stats');
  stats.append(chip('ポット', formatChips(pot)), chip('コール額', '—'));
  const row = node('div', 'action-row is-idle');
  for (const [label, tone] of [['フォールド', 'fold'], ['チェック', 'neutral'], ['レイズ', 'raise'], ['オールイン', 'allin']] as const) {
    const button = node('button', `action-button tone-${tone}`);
    button.type = 'button';
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    button.append(node('span', 'action-label', label));
    row.append(button);
  }
  const status = node('p', 'dock-waiting', note);
  status.setAttribute('role', 'status');
  return [stats, row, status];
}

function renderActionControls(legal: LegalActions, currentBet: number, myStack: number, pot: number, pending: boolean): HTMLElement[] {
  const out: HTMLElement[] = [];
  const raiseLabel = currentBet === 0 ? 'ベット' : 'レイズ';
  const facing = legal.callAmount > 0;
  const stats = node('div', 'dock-stats');
  stats.append(chip('ポット', formatChips(pot)));
  if (facing) {
    stats.append(chip('コール額', formatChips(legal.callAmount)));
    stats.append(chip('必要勝率', `${formatPercent(getCallBreakEvenProbability(pot, legal.callAmount))}%`));
  } else stats.append(chip('コール額', 'なし'));
  out.push(stats);

  const row = node('div', 'action-row');
  const disabled = pending;
  // The fold button only exists when there is something to call; folding for free is rejected by the engine too.
  if (legal.canFold) {
    const fold = createActionButton('フォールド', { type: 'fold' }, 'fold', disabled, performAction);
    fold.dataset.shortcut = 'f';
    fold.setAttribute('aria-keyshortcuts', 'F');
    row.append(fold);
  }
  const passive = legal.canCheck
    ? createActionButton('チェック', { type: 'check' }, 'neutral', disabled, performAction)
    : createActionButton('コール', { type: 'call' }, 'neutral', disabled, performAction, myStack <= legal.callAmount ? `${formatChips(legal.callAmount)}（オールイン）` : formatChips(legal.callAmount));
  passive.dataset.shortcut = 'c';
  passive.setAttribute('aria-keyshortcuts', 'C');
  row.append(passive);
  if (legal.canRaise) {
    const raise = createActionButton(raiseLabel, { type: 'fold' }, 'raise', disabled, () => { store.raiseOpen = !store.raiseOpen; hooks.render(); });
    raise.dataset.shortcut = 'r';
    raise.setAttribute('aria-keyshortcuts', 'R');
    raise.setAttribute('aria-expanded', String(store.raiseOpen));
    row.append(raise);
  }
  let allInButton: HTMLButtonElement | null = null;
  const canAllIn = myStack > 0 && (legal.canRaise || myStack <= legal.callAmount);
  if (canAllIn) {
    // All-in is a separate, two-step control: a stray tap or the A key only arms it.
    const allIn = createActionButton('オールイン', { type: 'all-in' }, 'allin', disabled, () => { store.allInArmed = true; store.raiseOpen = false; hooks.render(); }, formatChips(myStack));
    allIn.dataset.shortcut = 'a';
    allIn.setAttribute('aria-keyshortcuts', 'A');
    allIn.classList.add('allin-button');
    allInButton = allIn;
  }
  out.push(row);
  if (allInButton && store.allInArmed) out.push(renderAllInConfirm(myStack, pending));
  else if (allInButton) { const wrap = node('div', 'allin-row'); wrap.append(allInButton); out.push(wrap); }

  if (legal.canRaise && store.raiseOpen) out.push(renderRaiseSheet(legal, currentBet, pot, raiseLabel, pending));
  return out;
}

function renderAllInConfirm(stack: number, pending: boolean): HTMLElement {
  const box = node('div', 'allin-confirm');
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', 'オールインの確認');
  box.append(node('p', 'allin-confirm-text', `残りの ${formatChips(stack)} チップをすべて賭けます。よろしいですか？`));
  const go = node('button', 'button button-primary', `オールインする`);
  go.type = 'button'; go.disabled = pending;
  go.addEventListener('click', () => performAction({ type: 'all-in' }));
  const cancel = node('button', 'button button-secondary', 'やめる');
  cancel.type = 'button';
  cancel.addEventListener('click', () => { store.allInArmed = false; hooks.render(); });
  const buttons = node('div', 'allin-confirm-actions');
  buttons.append(cancel, go);
  box.append(buttons);
  return box;
}

function renderRaiseSheet(legal: LegalActions, currentBet: number, pot: number, raiseLabel: string, pending: boolean): HTMLElement {
  const sheet = node('div', 'raise-sheet');
  const min = Math.min(legal.minRaiseTo, legal.maxRaiseTo);
  const max = legal.maxRaiseTo;
  if (store.raiseValue < min || store.raiseValue > max) store.raiseValue = min;
  const top = node('div', 'raise-top');
  top.append(node('span', 'raise-caption', `${raiseLabel}の合計額`));
  const amount = node('output', 'raise-amount', formatChips(store.raiseValue));
  top.append(amount);
  const range = node('input', 'raise-range');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = '1';
  range.value = String(store.raiseValue);
  range.disabled = pending;
  range.setAttribute('aria-label', `${raiseLabel}額`);
  const confirm = node('button', 'button button-primary button-large raise-confirm', `${raiseLabel} ${formatChips(store.raiseValue)}`);
  confirm.type = 'button';
  confirm.disabled = pending;
  const update = (): void => {
    store.raiseValue = Number(range.value);
    amount.textContent = formatChips(store.raiseValue);
    confirm.textContent = `${raiseLabel} ${formatChips(store.raiseValue)}`;
  };
  range.addEventListener('input', update);
  confirm.addEventListener('click', () => {
    const target = Number(range.value);
    // Raising by the entire stack is an all-in too, so it goes through the same confirmation.
    if (target >= legal.maxRaiseTo) { store.allInArmed = true; store.raiseOpen = false; hooks.render(); return; }
    const action: BettingAction = target === legal.maxRaiseTo && target < legal.minRaiseTo ? { type: 'all-in' } : { type: currentBet === 0 ? 'bet' : 'raise', to: target };
    performAction(action);
  });
  const presets = node('div', 'raise-presets');
  const potAfterCall = pot + (currentBet === 0 ? 0 : legal.callAmount);
  const target = (fraction: number): number => currentBet === 0 ? Math.floor(pot * fraction) : currentBet + Math.floor(potAfterCall * fraction);
  for (const preset of [
    { label: '最小', value: min }, { label: '1/2', value: target(0.5) }, { label: '3/4', value: target(0.75) },
    { label: 'ポット', value: target(1) }, { label: '最大', value: max },
  ]) {
    const button = node('button', 'preset', preset.label);
    button.type = 'button';
    button.disabled = pending;
    button.setAttribute('aria-label', `${preset.label}サイズを選択`);
    button.addEventListener('click', () => { range.value = String(Math.max(min, Math.min(max, preset.value))); update(); });
    presets.append(button);
  }
  sheet.append(top, range, presets, confirm);
  return sheet;
}

type InfoArgs = Readonly<{ legal: LegalActions | null; equity: ReturnType<typeof currentEquity>; pot: number }>;

function renderInfo(args: InfoArgs): HTMLElement {
  const table = store.table!;
  const hand = table.hand!;
  const isOnline = store.mode === 'online-playing';
  const info = node('div', 'play-info');
  const me = hand.players.find((player) => player.id === store.humanId);

  if (!rankVisible()) {
    info.append(node('p', 'info-card lesson-placeholder', 'このルームでは、ホストの設定により現在の役は表示されません。'));
  } else if (me && hand.board.length >= 3 && hand.stage !== 'complete') {
    const explanation = explainHand(evaluateHand([...me.holeCards, ...hand.board]));
    const lesson = node('section', 'info-card lesson');
    lesson.append(node('span', 'eyebrow', 'YOUR HAND'), node('strong', 'lesson-title', explanation.name), node('p', '', explanation.reason));
    const made = node('div', 'made-with');
    for (const item of explanation.cards) made.append(node('span', `mini-card${item.card.suit === 'hearts' || item.card.suit === 'diamonds' ? ' red-suit' : ''}`, item.label));
    lesson.append(made);
    info.append(lesson);
  } else if (hand.stage !== 'complete') {
    info.append(node('p', 'info-card lesson-placeholder', 'フロップが公開されると、現在成立している役と構成カードをここに表示します。'));
  }

  const log = hand.actionLog ?? [];
  if (log.length) {
    const card = node('section', 'info-card action-log');
    card.append(node('span', 'eyebrow', 'ACTION LOG'));
    const list = node('ol', 'action-log-list');
    let lastStage = '';
    for (const record of [...log].reverse().slice(0, 14)) {
      const item = node('li', record.playerId === store.humanId ? 'is-you' : '');
      if (record.stage !== lastStage) { item.append(node('span', 'log-stage', stageLabel(record.stage))); lastStage = record.stage; }
      item.append(node('strong', '', playerLabel(record.playerId)), document.createTextNode(` ${describeAction(record)}`));
      list.append(item);
    }
    card.append(list);
    info.append(card);
  }

  if (args.legal) {
    const tips = details('アクションの意味とヒント', 'info-card');
    const legal = args.legal;
    const callRequired = (hand.bettingRound?.currentBet ?? 0) - (me?.streetContribution ?? 0);
    tips.append(node('p', '', legal.canCheck
      ? 'チェックはチップを追加せずに順番を進めます。誰かがベットすると、次の番ではコールかフォールドを選びます。'
      : legal.callAmount < callRequired
        ? 'コール額が残りチップを超えているため、コールを選ぶとオールインになります。'
        : 'コールは現在のベットに必要な分を出します。フォールドするとこのハンドから降り、すでに出したチップは戻りません。'));
    if (legal.canRaise) tips.append(node('p', '', 'ベットはまだ誰も賭けていないとき、レイズは相手のベットを上げるときに使います。スライダーの金額は、このラウンドで出す合計額です。'));
    if (legal.callAmount > 0) tips.append(node('p', 'muted', '「必要勝率」はコールで損益が分かれる目安です。引き分けや以降のベット、実際の勝率は含みません。'));
    tips.append(node('p', 'muted', 'キーボード: F フォールド / C チェック・コール / R レイズ / A オールイン / N 次のハンド'));
    info.append(tips);
  }

  if (args.equity && args.legal) {
    const coach = node('section', 'info-card coach');
    const toggle = node('button', 'button button-secondary button-small', store.coachOpen ? 'コーチのアドバイスを閉じる' : 'AIコーチに相談');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(store.coachOpen));
    toggle.addEventListener('click', () => { store.coachOpen = !store.coachOpen; hooks.render(); });
    coach.append(toggle);
    if (store.coachOpen) {
      coach.append(node('p', '', coachAdvice(args.equity, args.legal, args.pot)), node('p', 'muted', '勝率は未知の手札をランダムに配ったシミュレーションです。相手のプレイ傾向や将来のベットは含みません。'));
    }
    info.append(coach);
  }

  const history = details(`このハンドの履歴 (${store.handHistory.length})`, 'info-card');
  const list = node('ol', 'history-list');
  if (store.handHistory.length === 0) list.append(node('li', 'muted', '最初のアクション後にここへ記録されます。'));
  else for (const event of store.handHistory) list.append(node('li', '', event));
  history.append(list);
  info.append(history);

  const guide = details('はじめての方へ：遊び方', 'info-card');
  guide.append(
    node('p', '', '手札2枚と、テーブル中央に順番に出る共通カード5枚から、いちばん強い5枚の役を作ります。'),
    node('p', '', '自分の番では、チェック（追加せず進む）、コール（相手に合わせる）、レイズ（ベットを上げる）、フォールド（降りる）などを選びます。'),
    node('p', 'muted', 'ゲーム内チップに金銭的価値はありません。'),
  );
  info.append(guide);

  if (!isOnline) info.append(renderStats());

  const links = node('nav', 'info-links');
  links.setAttribute('aria-label', 'ポーカーガイド');
  for (const [label, href] of [['用語集', '/glossary'], ['役の強さ一覧', '/hands'], ['ホーム', '/']] as const) {
    const link = node('a', 'link-pill', label) as HTMLAnchorElement;
    link.href = href;
    links.append(link);
  }
  info.append(links);
  const identity = store.guestOnlineReady ? 'ゲスト認証済み' : store.guestError ? 'ゲスト認証に接続できません（練習モードで動作中）' : '端末内ゲスト';
  info.append(node('p', 'muted info-foot', `${identity} · ゲーム内チップに金銭的価値はありません`));
  return info;
}

function renderStats(): HTMLElement {
  const archive = details(`最近のハンドと戦績 (${store.recentHands.length}/10)`, 'info-card');
  const recorded = store.recentHands.filter((item) => item.outcome !== undefined && item.chipsChange !== undefined);
  const wins = recorded.filter((item) => item.outcome === 'win').length;
  const losses = recorded.filter((item) => item.outcome === 'loss').length;
  const draws = recorded.filter((item) => item.outcome === 'draw').length;
  const net = recorded.reduce((sum, item) => sum + (item.chipsChange ?? 0), 0);
  const stats = node('div', 'stats-grid');
  stats.append(
    chip('勝ち', String(wins)), chip('負け', String(losses)), chip('引き分け', String(draws)),
    chip('勝率', recorded.length ? `${formatPercent(wins / recorded.length)}%` : '—'),
    chip('チップ増減', `${net > 0 ? '+' : ''}${formatChips(net)}`),
    chip('1ハンド平均', recorded.length ? `${net / recorded.length > 0 ? '+' : ''}${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(net / recorded.length)}` : '—'),
  );
  archive.append(node('p', 'muted', `直近10ハンド中 ${recorded.length} ハンドを集計`), stats);
  if (store.recentHands.length === 0) archive.append(node('p', 'muted', 'ハンドが終了すると、ここに結果が保存されます。'));
  else {
    for (const item of store.recentHands) {
      const entry = details(`ハンド ${item.handNumber} · ${new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(item.completedAt))} · ${item.result}`, 'archive-entry');
      if (item.board.length) entry.append(node('p', 'muted', `ボード: ${item.board.join(' ')}`));
      const actions = node('ol', 'history-list');
      for (const action of item.actions) actions.append(node('li', '', action));
      entry.append(actions);
      archive.append(entry);
    }
    const clear = node('button', 'button button-ghost button-small', '履歴を消去');
    clear.type = 'button';
    clear.addEventListener('click', () => { clearArchive(); hooks.render(); });
    archive.append(clear);
  }
  return archive;
}
