export type Contribution = Readonly<{ playerId: string; amount: number; folded: boolean }>;
export type Pot = Readonly<{ amount: number; eligiblePlayerIds: readonly string[] }>;

/** Builds main and side pots from total hand contributions. Folded chips remain in the pot. */
export function buildPots(contributions: readonly Contribution[]): Pot[] {
  const ids = new Set<string>();
  for (const c of contributions) {
    if (ids.has(c.playerId)) throw new Error(`Duplicate player: ${c.playerId}`);
    ids.add(c.playerId);
    if (!Number.isSafeInteger(c.amount) || c.amount < 0) throw new RangeError('Contributions must be non-negative safe integers');
  }
  const levels = [...new Set(contributions.map((c) => c.amount).filter((amount) => amount > 0))].sort((a, b) => a - b);
  let previous = 0;
  const pots: Pot[] = [];
  for (const level of levels) {
    const contributors = contributions.filter((c) => c.amount >= level);
    const amount = (level - previous) * contributors.length;
    const eligiblePlayerIds = contributors.filter((c) => !c.folded).map((c) => c.playerId);
    if (!eligiblePlayerIds.length) throw new Error('A pot cannot have no eligible players');
    pots.push({ amount, eligiblePlayerIds });
    previous = level;
  }
  return pots;
}

/** Splits a pot equally; leftover chips follow the supplied clockwise winner order. */
export function splitPot(amount: number, orderedWinners: readonly string[]): Map<string, number> {
  if (!Number.isSafeInteger(amount) || amount < 0 || orderedWinners.length === 0) throw new RangeError('Invalid pot split');
  const unique = [...new Set(orderedWinners)];
  const share = Math.floor(amount / unique.length);
  let remainder = amount % unique.length;
  return new Map(unique.map((id) => [id, share + (remainder-- > 0 ? 1 : 0)]));
}
