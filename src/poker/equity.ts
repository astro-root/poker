import { createDeck, type Card } from './cards.ts';
import { compareHands, evaluateHand } from './evaluator.ts';

export type EquityEstimate = Readonly<{ equity: number; win: number; tie: number; samples: number }>;

/** Monte Carlo equity estimate for a known hand against randomly dealt opponents. */
export function estimateEquity(
  holeCards: readonly [Card, Card],
  board: readonly Card[],
  activeOpponents: number,
  foldedOpponents = 0,
  samples = 300,
): EquityEstimate {
  if (![0, 3, 4, 5].includes(board.length)) throw new RangeError('Board must contain zero, three, four, or five cards');
  if (!Number.isInteger(activeOpponents) || activeOpponents < 1 || !Number.isInteger(foldedOpponents) || foldedOpponents < 0) {
    throw new RangeError('Opponent counts are invalid');
  }
  if (!Number.isInteger(samples) || samples < 1) throw new RangeError('Sample count must be positive');
  const known = [...holeCards, ...board];
  const keys = new Set(known.map((card) => `${card.rank}:${card.suit}`));
  if (keys.size !== known.length) throw new Error('Duplicate known card');
  const base = createDeck().filter((card) => !keys.has(`${card.rank}:${card.suit}`));
  const needed = 2 * (activeOpponents + foldedOpponents) + (5 - board.length);
  if (needed > base.length) throw new RangeError('Not enough cards for the requested table');

  let equity = 0;
  let wins = 0;
  let ties = 0;
  for (let sample = 0; sample < samples; sample++) {
    const deck = [...base];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
    let cursor = 0;
    const opponents: (readonly [Card, Card])[] = [];
    for (let i = 0; i < activeOpponents + foldedOpponents; i++) {
      opponents.push([deck[cursor++]!, deck[cursor++]!]);
    }
    const runout = [...board, ...deck.slice(cursor, cursor + 5 - board.length)];
    const hero = evaluateHand([...holeCards, ...runout]).rank;
    let best = hero;
    let tiedWinners = 1;
    let heroWins = true;
    for (let i = 0; i < activeOpponents; i++) {
      const rival = evaluateHand([...opponents[i]!, ...runout]).rank;
      const comparison = compareHands(rival, best);
      if (comparison > 0) {
        best = rival;
        tiedWinners = 1;
        heroWins = false;
      } else if (comparison === 0) {
        tiedWinners++;
      }
    }
    if (compareHands(hero, best) === 0) {
      equity += 1 / tiedWinners;
      if (tiedWinners === 1) wins++;
      else ties++;
    }
  }
  return { equity: equity / samples, win: wins / samples, tie: ties / samples, samples };
}
