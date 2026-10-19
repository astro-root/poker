import { randomInt } from 'node:crypto';

export const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
export type Suit = (typeof SUITS)[number];
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export type Card = Readonly<{ rank: Rank; suit: Suit }>;

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) =>
    Array.from({ length: 13 }, (_, i) => ({ rank: (i + 2) as Rank, suit })),
  );
}

/** Fisher-Yates shuffle using Node's cryptographic random integer source. */
export function shuffle<T>(items: readonly T[]): T[] {
  const deck = [...items];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

export function deal(deck: Card[], count: number): Card[] {
  if (!Number.isInteger(count) || count < 0 || count > deck.length) {
    throw new RangeError('Deal count must be between zero and the remaining deck size');
  }
  return deck.splice(0, count);
}
