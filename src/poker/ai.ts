import type { Card } from './cards.ts';
import { getLegalActions, type BettingAction, type LegalActions } from './betting.ts';
import { evaluateHand } from './evaluator.ts';
import { applyHandAction, getHandPot, type PokerHand } from './hand.ts';
import { estimateEquity } from './equity.ts';

export type AiStyle = 'aggressive' | 'balanced' | 'cautious';
/** Skill tiers selectable by the player. `weak` is easy to beat; `strongest` plays equity-based poker. */
export type AiLevel = 'weak' | 'medium' | 'strong' | 'strongest';
export const AI_LEVELS = ['weak', 'medium', 'strong', 'strongest'] as const satisfies readonly AiLevel[];
export const AI_LEVEL_LABELS: Readonly<Record<AiLevel, string>> = {
  weak: '新兵', medium: '剣闘士', strong: '百人隊長', strongest: '皇帝',
};
export const AI_LEVEL_DESCRIPTIONS: Readonly<Record<AiLevel, string>> = {
  weak: '初心者向け。判断にムラがあり、降りるべき場面でも付き合いがち。',
  medium: '標準。手の強さとポットオッズを見て、堅実に打つ。',
  strong: '勝率をシミュレーションして判断。ブラフにも反応する。',
  strongest: '高精度の勝率計算で、バリューベットと駆け引きまで使いこなす。',
};

export type AiDecisionContext = Readonly<{
  playerId: string;
  holeCards: readonly [Card, Card];
  board: readonly Card[];
  legalActions: LegalActions;
  stack: number;
  pot: number;
  streetContribution: number;
  currentBet: number;
  style?: AiStyle;
  level?: AiLevel;
  /** Injectable [0,1) random source so tests are deterministic. */
  random?: () => number;
  activeOpponentCount?: number;
  /**
   * Opponents this AI must actually beat when facing a bet: live players who already matched the
   * current bet or are all-in. Players still to act may yet fold, so counting them as full opponents
   * made every AI treat a heads-up shove like a multiway pot and fold far too often.
   */
  committedOpponentCount?: number;
  /** Players who folded earlier this hand; used only for equity simulation sizing. */
  foldedOpponentCount?: number;
}>;

const AI_STYLES: Record<AiStyle, Readonly<{ openRaiseAt: number; raiseAt: number; callFactor: number; betPotFraction: number }>> = {
  aggressive: { openRaiseAt: 0.58, raiseAt: 0.74, callFactor: 0.58, betPotFraction: 0.7 },
  balanced: { openRaiseAt: 0.66, raiseAt: 0.84, callFactor: 0.78, betPotFraction: 0.4 },
  cautious: { openRaiseAt: 0.76, raiseAt: 0.92, callFactor: 1, betPotFraction: 0.3 },
};

const CATEGORY_STRENGTH = [0.16, 0.36, 0.56, 0.69, 0.79, 0.87, 0.94, 0.97, 0.99, 1] as const;

function preflopStrength([first, second]: readonly [Card, Card]): number {
  const high = Math.max(first.rank, second.rank);
  const low = Math.min(first.rank, second.rank);
  const pair = first.rank === second.rank;
  const gap = high - low;
  let strength = pair
    ? 0.53 + ((high - 2) / 12) * 0.36
    : 0.12 + ((high - 2) / 12) * 0.33 + ((low - 2) / 12) * 0.16;
  if (!pair && first.suit === second.suit) strength += 0.07;
  if (!pair && gap === 1) strength += 0.09;
  else if (!pair && gap === 2) strength += 0.05;
  else if (!pair && gap >= 5) strength -= Math.min(0.12, (gap - 4) * 0.02);
  if (!pair && low >= 10) strength += 0.08;
  if (!pair && high === 14) strength += 0.05;
  return Math.max(0.05, Math.min(0.96, strength));
}

function hasStraightDraw(cards: readonly Card[]): boolean {
  const ranks = [...new Set(cards.map((card) => card.rank === 14 ? [14, 1] : [card.rank]).flat())];
  for (let start = 1; start <= 10; start++) {
    if (ranks.filter((rank) => rank >= start && rank <= start + 4).length >= 4) return true;
  }
  return false;
}

function postflopStrength(cards: readonly Card[]): number {
  const evaluated = evaluateHand(cards);
  let strength = CATEGORY_STRENGTH[evaluated.rank.category];
  const board = cards.slice(2);
  if (board.length < 5) {
    const suitCounts = new Map<Card['suit'], number>();
    for (const card of cards) suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
    if ([...suitCounts.values()].some((count) => count === 4)) strength += 0.08;
    if (hasStraightDraw(cards)) strength += 0.06;
  }
  return Math.min(1, strength);
}

export function estimateAiHandStrength(holeCards: readonly [Card, Card], board: readonly Card[]): number {
  if (board.length !== 0 && board.length !== 3 && board.length !== 4 && board.length !== 5) {
    throw new RangeError('Board must contain zero, three, four, or five cards');
  }
  return board.length === 0 ? preflopStrength(holeCards) : postflopStrength([...holeCards, ...board]);
}

function chooseAggression(context: AiDecisionContext, strength: number, betPotFraction: number): BettingAction {
  const { legalActions: legal } = context;
  if (!legal.canRaise) return legal.canCheck ? { type: 'check' } : { type: 'call' };
  if (legal.maxRaiseTo < legal.minRaiseTo) return { type: 'all-in' };
  const target = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, context.currentBet + Math.max(1, Math.floor(context.pot * betPotFraction))));
  if (context.currentBet === 0) return { type: 'bet', to: target };
  return { type: 'raise', to: target };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sizedRaise(context: AiDecisionContext, potFraction: number): BettingAction {
  const { legalActions: legal } = context;
  if (!legal.canRaise) return legal.canCheck ? { type: 'check' } : { type: 'call' };
  if (legal.maxRaiseTo < legal.minRaiseTo) return { type: 'all-in' };
  const base = context.currentBet + Math.max(1, Math.floor((context.pot + legal.callAmount) * potFraction));
  const target = clamp(base, legal.minRaiseTo, legal.maxRaiseTo);
  if (target >= legal.maxRaiseTo) return { type: 'all-in' };
  return { type: context.currentBet === 0 ? 'bet' : 'raise', to: target };
}

/** Weak: noisy hand reading, loose calls, rare pressure. Intentionally beatable. */
function chooseWeakAction(context: AiDecisionContext, random: () => number): BettingAction {
  const { legalActions: legal } = context;
  const base = estimateAiHandStrength(context.holeCards, context.board);
  const strength = clamp(base + (random() - 0.5) * 0.5, 0, 1);
  if (legal.callAmount === 0) {
    if (legal.canRaise && (strength > 0.8 || random() < 0.08)) return sizedRaise(context, 0.3 + random() * 0.4);
    return { type: 'check' };
  }
  const potOdds = legal.callAmount / Math.max(1, context.pot + legal.callAmount);
  if (strength < potOdds * 0.35 && random() > 0.18) return { type: 'fold' };
  if (strength > 0.9 && legal.canRaise && random() < 0.5) return sizedRaise(context, 0.5);
  return { type: 'call' };
}

/** Medium: the original balanced heuristic. */
function chooseMediumAction(context: AiDecisionContext): BettingAction {
  return chooseAiAction({ ...context, level: undefined, style: context.style ?? 'balanced' });
}

/** Strong / strongest: Monte Carlo equity against the live opponents with pot-odds discipline. */
function chooseEquityAction(context: AiDecisionContext, random: () => number, level: 'strong' | 'strongest'): BettingAction {
  const { legalActions: legal } = context;
  const live = Math.max(1, context.activeOpponentCount ?? 1);
  // When facing a bet only the players already committed to the pot have to be beaten.
  const opponents = legal.callAmount > 0 ? Math.min(live, Math.max(1, context.committedOpponentCount ?? live)) : live;
  const folded = (context.foldedOpponentCount ?? 0) + (live - opponents);
  const strongest = level === 'strongest';
  const samples = strongest ? 700 : 220;
  const { equity } = estimateEquity(context.holeCards, context.board, opponents, folded, samples);
  const preflop = context.board.length === 0;
  const potOdds = legal.callAmount / Math.max(1, context.pot + legal.callAmount);
  // Equity vs random hands overstates strength against bets, so demand a margin that grows with the price.
  const margin = strongest ? 0.03 + potOdds * 0.12 : 0.02;
  const valueThreshold = clamp((strongest ? 0.62 : 0.68) - 0.02 * (opponents - 1) * 0, 0.5, 0.8);
  const bluffRate = strongest ? (preflop ? 0.05 : 0.14) : 0.04;

  if (legal.callAmount === 0) {
    if (legal.canRaise) {
      if (equity >= valueThreshold) return sizedRaise(context, equity > 0.82 ? 0.75 : 0.55);
      if (equity >= 0.45 && strongest && random() < 0.25) return sizedRaise(context, 0.4);
      if (equity < 0.4 && random() < bluffRate) return sizedRaise(context, 0.6);
    }
    return { type: 'check' };
  }
  const needed = potOdds + margin;
  if (equity < needed) {
    const cheap = legal.callAmount <= context.pot * 0.1;
    if (strongest && cheap && equity > potOdds) return { type: 'call' };
    if (strongest && legal.canRaise && random() < bluffRate * 0.5 && opponents === 1) return sizedRaise(context, 0.9);
    return { type: 'fold' };
  }
  if (legal.canRaise && equity >= clamp(valueThreshold + 0.06, 0.6, 0.9)) {
    return sizedRaise(context, equity > 0.85 ? 1 : 0.7);
  }
  if (legal.callAmount >= context.stack && equity < (strongest ? 0.55 : 0.5)) return { type: 'fold' };
  return { type: 'call' };
}

/**
 * A deliberately simple, synchronous opponent. Its input contains only this AI's
 * hole cards and public board cards; callers must never pass other players' hands.
 */
export function chooseAiAction(context: AiDecisionContext): BettingAction {
  if (!context.playerId || !Number.isSafeInteger(context.stack) || context.stack < 0
    || !Number.isSafeInteger(context.pot) || context.pot < 0
    || !Number.isSafeInteger(context.streetContribution) || context.streetContribution < 0
    || !Number.isSafeInteger(context.currentBet) || context.currentBet < 0) {
    throw new RangeError('Invalid AI decision context');
  }
  const opponentCount = context.activeOpponentCount ?? 1;
  if (!Number.isInteger(opponentCount) || opponentCount < 1 || opponentCount > 9) {
    throw new RangeError('Active opponent count must be between one and nine');
  }
  if (context.level !== undefined) {
    if (!(AI_LEVELS as readonly string[]).includes(context.level)) throw new RangeError('Unknown AI level');
    const random = context.random ?? Math.random;
    const action = context.level === 'weak' ? chooseWeakAction(context, random)
      : context.level === 'medium' ? chooseMediumAction(context)
        : chooseEquityAction(context, random, context.level);
    return sanitizeAction(context, action);
  }
  // More live opponents reduce confidence in the same made hand or draw.
  const { legalActions: legal } = context;
  const contested = legal.callAmount > 0 ? Math.min(opponentCount, Math.max(1, context.committedOpponentCount ?? opponentCount)) : opponentCount;
  const strength = Math.max(0, estimateAiHandStrength(context.holeCards, context.board) - 0.04 * (contested - 1));
  const styleName = context.style ?? 'balanced';
  if (!Object.hasOwn(AI_STYLES, styleName)) throw new RangeError('Unknown AI style');
  const style = AI_STYLES[styleName];
  if (legal.callAmount === 0) {
    if (legal.canRaise && strength >= style.openRaiseAt) return chooseAggression(context, strength, style.betPotFraction);
    if (legal.canCheck) return { type: 'check' };
    throw new Error('AI was given no legal check or betting action');
  }

  const potOdds = legal.callAmount / Math.max(1, context.pot + legal.callAmount);
  const pressure = legal.callAmount > context.stack * 0.3 ? 0.08 : 0;
  if (strength < potOdds * style.callFactor + pressure) return { type: 'fold' };
  if (strength >= style.raiseAt && legal.canRaise) return chooseAggression(context, strength, style.betPotFraction);
  return { type: 'call' };
}

/** Final guard: whatever a strategy picks, never emit an action the rules engine would reject. */
function sanitizeAction(context: AiDecisionContext, action: BettingAction): BettingAction {
  const legal = context.legalActions;
  if (action.type === 'fold' && !legal.canFold) return { type: 'check' };
  if (action.type === 'check' && !legal.canCheck) return { type: 'call' };
  if (action.type === 'call' && legal.callAmount === 0) return { type: 'check' };
  if ((action.type === 'bet' || action.type === 'raise') && (!legal.canRaise || action.to < legal.minRaiseTo || action.to > legal.maxRaiseTo)) {
    return legal.canCheck ? { type: 'check' } : { type: 'call' };
  }
  if (action.type === 'all-in' && context.stack <= 0) return legal.canCheck ? { type: 'check' } : { type: 'fold' };
  return action;
}

/** Builds the AI's view of the hand: its own cards plus public information only. */
export function buildAiContext(hand: PokerHand, playerId: string, level?: AiLevel, random?: () => number): AiDecisionContext {
  if (!hand.bettingRound || hand.bettingRound.actorId !== playerId) throw new Error('AI player is not the current actor');
  const player = hand.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error('AI player is not part of this hand');
  const others = hand.players.filter((candidate) => candidate.id !== playerId);
  return {
    playerId,
    holeCards: player.holeCards,
    board: hand.board,
    legalActions: getLegalActions(hand.bettingRound, playerId),
    stack: player.stack,
    pot: getHandPot(hand),
    streetContribution: player.streetContribution,
    currentBet: hand.bettingRound.currentBet,
    activeOpponentCount: Math.max(1, others.filter((candidate) => !candidate.folded).length),
    committedOpponentCount: Math.max(1, others.filter((candidate) => !candidate.folded
      && (candidate.stack === 0 || candidate.streetContribution >= hand.bettingRound!.currentBet)).length),
    foldedOpponentCount: others.filter((candidate) => candidate.folded).length,
    ...(level ? { level } : {}),
    ...(random ? { random } : {}),
  };
}

/** Runs the current actor's rule-based decision through the same server-side rules engine. */
export function applyAiTurn(hand: PokerHand, playerId: string, level?: AiLevel): PokerHand {
  return applyHandAction(hand, playerId, chooseAiAction(buildAiContext(hand, playerId, level)));
}
