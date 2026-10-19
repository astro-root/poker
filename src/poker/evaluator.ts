import type { Card, Rank, Suit } from './cards.ts';

export const HAND_NAMES = [
  'ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート',
  'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ', 'ロイヤルフラッシュ',
] as const;
export type HandCategory = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type HandRank = Readonly<{ category: HandCategory; kickers: readonly number[] }>;
export type EvaluatedHand = Readonly<{ rank: HandRank; cards: readonly Card[]; name: string }>;

function straightHigh(ranks: readonly number[]): number | undefined {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1); // Ace-low wheel: A-2-3-4-5.
  for (let i = 0; i <= unique.length - 5; i++) {
    if (unique[i]! - unique[i + 4]! === 4) return unique[i]!;
  }
  return undefined;
}

function rankFive(cards: readonly Card[]): HandRank {
  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts].sort(([ra, ca], [rb, cb]) => cb - ca || rb - ra);
  const flush = cards.every((card) => card.suit === cards[0]!.suit);
  const straight = straightHigh(ranks);
  if (flush && straight) return { category: straight === 14 ? 9 : 8, kickers: [straight] };
  if (groups[0]![1] === 4) return { category: 7, kickers: [groups[0]![0], groups[1]![0]] };
  if (groups[0]![1] === 3 && groups[1]![1] === 2) return { category: 6, kickers: [groups[0]![0], groups[1]![0]] };
  if (flush) return { category: 5, kickers: ranks };
  if (straight) return { category: 4, kickers: [straight] };
  if (groups[0]![1] === 3) return { category: 3, kickers: [groups[0]![0], ...groups.slice(1).map(([rank]) => rank)] };
  if (groups[0]![1] === 2 && groups[1]![1] === 2) {
    return { category: 2, kickers: [groups[0]![0], groups[1]![0], groups[2]![0]] };
  }
  if (groups[0]![1] === 2) return { category: 1, kickers: [groups[0]![0], ...groups.slice(1).map(([rank]) => rank)] };
  return { category: 0, kickers: ranks };
}

export function compareHands(a: HandRank, b: HandRank): number {
  if (a.category !== b.category) return a.category - b.category;
  const length = Math.max(a.kickers.length, b.kickers.length);
  for (let i = 0; i < length; i++) {
    const difference = (a.kickers[i] ?? 0) - (b.kickers[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function* combinations<T>(items: readonly T[], size: number, start = 0, chosen: T[] = []): Generator<T[]> {
  if (chosen.length === size) { yield [...chosen]; return; }
  for (let i = start; i <= items.length - (size - chosen.length); i++) {
    chosen.push(items[i]!);
    yield* combinations(items, size, i + 1, chosen);
    chosen.pop();
  }
}

/** Evaluates the best five-card hand from five to seven available cards. */
export function evaluateHand(cards: readonly Card[]): EvaluatedHand {
  if (cards.length < 5 || cards.length > 7) throw new RangeError('A hand must contain five to seven cards');
  const seen = new Set<string>();
  for (const card of cards) {
    const key = `${card.rank}:${card.suit}`;
    if (seen.has(key)) throw new Error('Duplicate card');
    seen.add(key);
  }
  let best: EvaluatedHand | undefined;
  for (const five of combinations(cards, 5)) {
    const rank = rankFive(five);
    if (!best || compareHands(rank, best.rank) > 0) {
      best = { rank, cards: five, name: HAND_NAMES[rank.category] };
    }
  }
  return best!;
}

export type { Rank, Suit };
