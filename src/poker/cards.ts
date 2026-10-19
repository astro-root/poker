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
    const j = secureRandomInt(i + 1);
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

/** Unbiased cryptographic integer generation shared by browsers and modern Node.js. */
function secureRandomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 0x1_0000_0000) {
    throw new RangeError('Random integer range is invalid');
  }
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / maxExclusive) * maxExclusive;
  const value = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(value);
  } while (value[0]! >= limit);
  return value[0]! % maxExclusive;
}

export function deal(deck: Card[], count: number): Card[] {
  if (!Number.isInteger(count) || count < 0 || count > deck.length) {
    throw new RangeError('Deal count must be between zero and the remaining deck size');
  }
  return deck.splice(0, count);
}
