import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck, deal, shuffle, type Card } from '../src/poker/cards.ts';
import { compareHands, evaluateHand } from '../src/poker/evaluator.ts';
import { buildPots, splitPot } from '../src/poker/pots.ts';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

test('deck, secure shuffle, and deal have 52 unique cards', () => {
  const deck = createDeck();
  assert.equal(new Set(deck.map((card) => `${card.rank}:${card.suit}`)).size, 52);
  const shuffled = shuffle(deck);
  assert.equal(shuffled.length, 52);
  assert.deepEqual(new Set(shuffled.map((card) => `${card.rank}:${card.suit}`)), new Set(deck.map((card) => `${card.rank}:${card.suit}`)));
  assert.equal(deal(shuffled, 2).length, 2);
  assert.throws(() => deal(shuffled, 99), RangeError);
});

test('recognizes royal flush and ace-low straight flush', () => {
  assert.equal(evaluateHand([c(10,'hearts'),c(11,'hearts'),c(12,'hearts'),c(13,'hearts'),c(14,'hearts'),c(2,'clubs'),c(3,'spades')]).rank.category, 9);
  assert.deepEqual(evaluateHand([c(14,'clubs'),c(2,'clubs'),c(3,'clubs'),c(4,'clubs'),c(5,'clubs')]).rank, { category: 8, kickers: [5] });
});

test('compares kickers, full houses, and ignores suits', () => {
  const pairA = evaluateHand([c(14,'clubs'),c(14,'diamonds'),c(13,'clubs'),c(12,'hearts'),c(9,'spades')]);
  const pairB = evaluateHand([c(14,'hearts'),c(14,'spades'),c(13,'diamonds'),c(11,'hearts'),c(9,'clubs')]);
  assert.ok(compareHands(pairA.rank, pairB.rank) > 0);
  assert.ok(compareHands(evaluateHand([c(10,'clubs'),c(10,'diamonds'),c(10,'hearts'),c(2,'clubs'),c(2,'diamonds')]).rank,
    evaluateHand([c(9,'clubs'),c(9,'diamonds'),c(9,'hearts'),c(14,'clubs'),c(14,'diamonds')]).rank) > 0);
  assert.equal(compareHands(pairA.rank, evaluateHand([c(14,'diamonds'),c(14,'hearts'),c(13,'hearts'),c(12,'clubs'),c(9,'diamonds')]).rank), 0);
});

test('chooses best five from seven and rejects duplicate cards', () => {
  const best = evaluateHand([c(14,'clubs'),c(14,'diamonds'),c(14,'hearts'),c(14,'spades'),c(13,'clubs'),c(13,'diamonds'),c(2,'hearts')]);
  assert.equal(best.rank.category, 7);
  assert.throws(() => evaluateHand([c(2,'clubs'),c(2,'clubs'),c(3,'clubs'),c(4,'clubs'),c(5,'clubs')]));
});

test('builds side pots including folded contributions and splits odd chips', () => {
  assert.deepEqual(buildPots([
    { playerId: 'a', amount: 100, folded: false },
    { playerId: 'b', amount: 60, folded: false },
    { playerId: 'c', amount: 100, folded: true },
  ]), [
    { amount: 180, eligiblePlayerIds: ['a', 'b'] },
    { amount: 80, eligiblePlayerIds: ['a'] },
  ]);
  assert.deepEqual([...splitPot(5, ['a', 'b'])], [['a', 3], ['b', 2]]);
});
