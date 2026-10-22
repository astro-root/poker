import { estimateEquity, type EquityEstimate } from '../poker/equity.ts';
import { getCallBreakEvenProbability } from '../poker/education.ts';
import type { LegalActions } from '../poker/betting.ts';
import { cardLabel } from '../ui/components/card.ts';
import { store } from './state.ts';

/** Equity of the human's hand against random holdings; cached per (hand, board, opponents). */
export function currentEquity(): EquityEstimate | null {
  const hand = store.table?.hand;
  if (!hand || hand.stage === 'complete') return null;
  const me = hand.players.find((player) => player.id === store.humanId);
  if (!me || me.folded) return null;
  const opponents = hand.players.filter((player) => player.id !== store.humanId);
  const active = opponents.filter((player) => !player.folded).length;
  if (active === 0) return null;
  const key = [me.holeCards.map(cardLabel).join(','), hand.board.map(cardLabel).join(','), opponents.length - active, active].join('|');
  const cached = store.equityCache.get(key);
  if (cached) return cached;
  const estimate = estimateEquity(me.holeCards, hand.board, active, opponents.length - active, 240);
  store.equityCache.set(key, estimate);
  if (store.equityCache.size > 24) store.equityCache.delete(store.equityCache.keys().next().value!);
  return estimate;
}

const pct = (value: number): string => (value * 100).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
export const formatPercent = pct;

export function coachAdvice(equity: EquityEstimate, legal: LegalActions, pot: number): string {
  if (legal.callAmount > 0) {
    const required = getCallBreakEvenProbability(pot, legal.callAmount);
    return equity.equity >= required
      ? `推定勝率は約${pct(equity.equity)}%。コールの損益分岐点${pct(required)}%を上回っています。相手の次のベットや推定誤差も考慮して判断しましょう。`
      : `推定勝率は約${pct(equity.equity)}%。コールの損益分岐点${pct(required)}%を下回っています。必要チップと相手の強さを見直しましょう。`;
  }
  if (legal.canCheck) return `推定勝率は約${pct(equity.equity)}%。追加コストなしで次のカードを見られます。チェックで進むか、強い手からバリューを取るかを考えましょう。`;
  return `推定勝率は約${pct(equity.equity)}%。この数字はランダムな相手の手札を使ったシミュレーションです。`;
}
