import type { Card } from './cards.ts';
import { compareHands, evaluateHand, type EvaluatedHand } from './evaluator.ts';
import { buildPots, splitPot, type Contribution } from './pots.ts';

export type ShowdownPlayer = Readonly<Contribution & {
  holeCards: readonly [Card, Card];
}>;

export type PotResult = Readonly<{
  amount: number;
  eligiblePlayerIds: readonly string[];
  winnerIds: readonly string[];
  payouts: Readonly<Record<string, number>>;
}>;

export type ShowdownResult = Readonly<{
  totalPot: number;
  payouts: Readonly<Record<string, number>>;
  hands: Readonly<Record<string, EvaluatedHand>>;
  pots: readonly PotResult[];
}>;

function validateCards(players: readonly ShowdownPlayer[], board: readonly Card[]): void {
  const dealtCards = [...board, ...players.flatMap((player) => player.holeCards)];
  const seen = new Set<string>();
  for (const card of dealtCards) {
    const key = `${card.rank}:${card.suit}`;
    if (seen.has(key)) throw new Error('Duplicate card in showdown');
    seen.add(key);
  }
}

/**
 * Awards every main/side pot. `players` is in clockwise seat order and odd chips
 * go to tied winners clockwise after the dealer button.
 */
export function resolveShowdown(
  players: readonly ShowdownPlayer[],
  board: readonly Card[],
  buttonPlayerId: string,
): ShowdownResult {
  if (board.length !== 5) throw new RangeError('Showdown requires all five community cards');
  if (players.length < 2) throw new RangeError('Showdown requires at least two players');
  const ids = new Set(players.map((player) => player.playerId));
  if (ids.size !== players.length || players.some((player) => !player.playerId)) throw new Error('Player IDs must be unique and non-empty');
  const buttonIndex = players.findIndex((player) => player.playerId === buttonPlayerId);
  if (buttonIndex < 0) throw new Error('Dealer button must belong to a player at the table');
  validateCards(players, board);

  const hands: Record<string, EvaluatedHand> = {};
  for (const player of players) {
    if (!player.folded) hands[player.playerId] = evaluateHand([...player.holeCards, ...board]);
  }
  const contributions: Contribution[] = players.map(({ playerId, amount, folded }) => ({ playerId, amount, folded }));
  const pots = buildPots(contributions);
  const payouts: Record<string, number> = Object.fromEntries(players.map((player) => [player.playerId, 0]));
  const results: PotResult[] = [];

  for (const pot of pots) {
    let winningRank = hands[pot.eligiblePlayerIds[0]!]!.rank;
    let winners = [pot.eligiblePlayerIds[0]!];
    for (const playerId of pot.eligiblePlayerIds.slice(1)) {
      const comparison = compareHands(hands[playerId]!.rank, winningRank);
      if (comparison > 0) {
        winningRank = hands[playerId]!.rank;
        winners = [playerId];
      } else if (comparison === 0) {
        winners.push(playerId);
      }
    }

    const winnerSet = new Set(winners);
    const clockwiseWinners: string[] = [];
    for (let offset = 1; offset <= players.length; offset++) {
      const playerId = players[(buttonIndex + offset) % players.length]!.playerId;
      if (winnerSet.has(playerId)) clockwiseWinners.push(playerId);
    }
    const potPayouts = Object.fromEntries(splitPot(pot.amount, clockwiseWinners));
    for (const [playerId, amount] of Object.entries(potPayouts)) payouts[playerId] = payouts[playerId]! + amount;
    results.push({ amount: pot.amount, eligiblePlayerIds: pot.eligiblePlayerIds, winnerIds: clockwiseWinners, payouts: potPayouts });
  }

  const totalPot = contributions.reduce((sum, contribution) => sum + contribution.amount, 0);
  if (!Number.isSafeInteger(totalPot) || Object.values(payouts).reduce((sum, amount) => sum + amount, 0) !== totalPot) {
    throw new Error('Pot settlement did not conserve chips');
  }
  return { totalPot, payouts, hands, pots: results };
}
