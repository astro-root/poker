import type { Card } from './cards.ts';
import { getLegalActions, type BettingAction, type LegalActions } from './betting.ts';
import { evaluateHand } from './evaluator.ts';
import { applyHandAction, getHandPot, type PokerHand } from './hand.ts';

export type AiStyle = 'aggressive' | 'balanced' | 'cautious';

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
  const strength = estimateAiHandStrength(context.holeCards, context.board);
  const { legalActions: legal } = context;
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

/** Runs the current actor's rule-based decision through the same server-side rules engine. */
export function applyAiTurn(hand: PokerHand, playerId: string): PokerHand {
  if (!hand.bettingRound || hand.bettingRound.actorId !== playerId) throw new Error('AI player is not the current actor');
  const player = hand.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error('AI player is not part of this hand');
  const action = chooseAiAction({
    playerId,
    holeCards: player.holeCards,
    board: hand.board,
    legalActions: getLegalActions(hand.bettingRound, playerId),
    stack: player.stack,
    pot: getHandPot(hand),
    streetContribution: player.streetContribution,
    currentBet: hand.bettingRound.currentBet,
  });
  return applyHandAction(hand, playerId, action);
}
