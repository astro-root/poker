import test from 'node:test';
import assert from 'node:assert/strict';
import type { Card } from '../src/poker/cards.ts';
import { applyTableAction, createTable, startNextHand, type TableState } from '../src/poker/table.ts';
import { buildAiContext, chooseAiAction, type AiLevel } from '../src/poker/ai.ts';
import type { BettingAction } from '../src/poker/betting.ts';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const total = (table: TableState): number => table.seats.reduce((sum, seat) => sum + seat.stack, 0);

/** Replaces the dealt hole cards so decisions are deterministic. The board and deck stay random but valid. */
function withHoleCards(table: TableState, cards: Record<string, readonly [Card, Card]>): TableState {
  const used = new Set(Object.values(cards).flat().map((card) => `${card.rank}:${card.suit}`));
  const hand = table.hand!;
  const deck = [...hand.deck.filter((card) => !used.has(`${card.rank}:${card.suit}`))];
  const players = hand.players.map((player) => cards[player.id] ? { ...player, holeCards: cards[player.id]! } : player);
  // Cards taken out of other hands go back into the deck so the deck/board stay duplicate-free.
  const released = hand.players.flatMap((player) => cards[player.id] ? [...player.holeCards] : [])
    .filter((card) => !used.has(`${card.rank}:${card.suit}`));
  return { ...table, hand: { ...hand, players, deck: [...deck, ...released] } };
}

function seated(stacks: readonly number[]): TableState {
  return startNextHand(createTable(stacks.map((stack, index) => ({ id: `p${index}`, stack })), 5, 10));
}

function actorOf(table: TableState): string { return table.hand!.bettingRound!.actorId!; }
function act(table: TableState, action: BettingAction): TableState {
  return applyTableAction(table, table.version, actorOf(table), action);
}

/** Plays the hand out with every remaining actor choosing the same action (call, else check, else fold). */
function finishWith(table: TableState, choose: (t: TableState) => BettingAction): TableState {
  let next = table;
  for (let guard = 0; guard < 60 && next.hand!.stage !== 'complete'; guard++) next = act(next, choose(next));
  return next;
}
const callOrCheck = (t: TableState): BettingAction => {
  const round = t.hand!.bettingRound!;
  const me = round.players.find((p) => p.id === round.actorId)!;
  return round.currentBet > me.streetContribution ? { type: 'call' } : { type: 'check' };
};

test('AI all-in is applied as a raise to the full stack, never as a fold', () => {
  const table = seated([1000, 1000, 1000]);
  const shover = actorOf(table);
  const after = act(table, { type: 'all-in' });
  const player = after.hand!.players.find((p) => p.id === shover)!;
  assert.equal(player.folded, false);
  assert.equal(player.stack, 0);
  assert.equal(after.hand!.bettingRound!.currentBet, 1000);
  assert.notEqual(after.hand!.bettingRound!.actorId, shover);
});

test('a strong hand calls an all-in at every AI level; trash folds at medium and above', () => {
  const s1 = act(seated([1000, 1000]), { type: 'all-in' });
  const responderId = actorOf(s1);
  const aaSpot = withHoleCards(s1, { [responderId]: [c(14, 'spades'), c(14, 'hearts')] });
  const trashSpot = withHoleCards(s1, { [responderId]: [c(7, 'clubs'), c(2, 'diamonds')] });
  for (const level of ['weak', 'medium', 'strong', 'strongest'] as AiLevel[]) {
    const action = chooseAiAction(buildAiContext(aaSpot.hand!, responderId, level, () => 0.5));
    assert.ok(action.type === 'call' || action.type === 'all-in', `${level} should call with aces, got ${action.type}`);
  }
  for (const level of ['medium', 'strong', 'strongest'] as AiLevel[]) {
    const action = chooseAiAction(buildAiContext(trashSpot.hand!, responderId, level, () => 0.5));
    assert.equal(action.type, 'fold', `${level} should fold 7-2 offsuit to a full-stack shove`);
  }
});

test('players who have not acted yet are not counted as opponents the AI must beat', () => {
  const table = seated([1000, 1000, 1000, 1000]);
  const shoved = act(table, { type: 'all-in' });
  const context = buildAiContext(shoved.hand!, actorOf(shoved));
  assert.equal(context.activeOpponentCount, 3);
  assert.equal(context.committedOpponentCount, 1, 'only the shover has matched the bet; the others may still fold');
});

test('AI shoves and another AI calls: the hand runs to showdown and chips are conserved', () => {
  const table = seated([1000, 1000]);
  const done = finishWith(act(table, { type: 'all-in' }), () => ({ type: 'call' }));
  assert.equal(done.hand!.stage, 'complete');
  assert.equal(done.hand!.result!.type, 'showdown');
  assert.equal(done.hand!.board.length, 5);
  assert.equal(total(done), 2000);
});

test('AI shoves and the other AI folds: shover wins without showdown and the blinds only', () => {
  const table = seated([1000, 1000]);
  const shover = actorOf(table);
  const done = finishWith(act(table, { type: 'all-in' }), () => ({ type: 'fold' }));
  assert.equal(done.hand!.stage, 'complete');
  assert.equal(done.hand!.result!.type, 'uncontested');
  const result = done.hand!.result!;
  if (result.type === 'uncontested') assert.equal(result.winnerId, shover);
  assert.equal(total(done), 2000);
  assert.ok(done.seats.find((seat) => seat.id === shover)!.stack > 1000);
});

test('several AIs in turn: call, fold, call after one shove keeps the pot and board consistent', () => {
  let table = seated([1000, 1000, 1000, 1000]);
  const shover = actorOf(table);
  table = act(table, { type: 'all-in' });
  const plan: BettingAction[] = [{ type: 'call' }, { type: 'fold' }, { type: 'call' }];
  for (const action of plan) table = act(table, action);
  assert.equal(table.hand!.stage, 'complete');
  assert.equal(table.hand!.result!.type, 'showdown');
  assert.equal(total(table), 4000);
  const outcome = table.hand!.result!;
  const contenders = Object.keys(outcome.type === 'showdown' ? outcome.settlement.hands : {});
  assert.equal(contenders.length, 3);
  assert.ok(contenders.includes(shover));
});

test('everyone else folding to a shove awards the pot to the shover and returns the uncalled chips', () => {
  let table = seated([1000, 500, 500]);
  const shover = actorOf(table);
  table = act(table, { type: 'all-in' });
  while (table.hand!.stage !== 'complete') table = act(table, { type: 'fold' });
  const result = table.hand!.result!;
  assert.equal(result.type, 'uncontested');
  assert.equal(total(table), 2000);
  const mine = table.seats.find((seat) => seat.id === shover)!;
  assert.ok(mine.stack >= 1000 - 0, 'the shover never ends below the starting stack after everyone folds');
});

test('unequal stacks create side pots, run out the board, and conserve every chip', () => {
  let table = withHoleCards(seated([300, 1000, 600]), {
    p0: [c(14, 'spades'), c(14, 'hearts')], p1: [c(13, 'spades'), c(13, 'hearts')], p2: [c(12, 'spades'), c(12, 'hearts')],
  });
  table = act(table, { type: 'all-in' });
  table = finishWith(table, (t) => {
    const round = t.hand!.bettingRound!;
    const me = round.players.find((p) => p.id === round.actorId)!;
    return me.stack > 0 && round.currentBet > me.streetContribution ? { type: 'all-in' } : callOrCheck(t);
  });
  const result = table.hand!.result!;
  assert.equal(result.type, 'showdown');
  if (result.type === 'showdown') {
    assert.ok(result.settlement.pots.length >= 2, 'a 300/600/1000 all-in must produce a main pot and at least one side pot');
    assert.equal(result.settlement.totalPot + (result.returned?.amount ?? 0), 1900);
  }
  assert.equal(total(table), 1900);
  assert.equal(table.hand!.board.length, 5);
});

test('after an all-in call there are no further betting actions and the game state ends cleanly', () => {
  const table = seated([1000, 1000]);
  const done = finishWith(act(table, { type: 'all-in' }), () => ({ type: 'call' }));
  assert.equal(done.hand!.bettingRound, null);
  assert.throws(() => applyTableAction(done, done.version, 'p0', { type: 'check' }));
});
