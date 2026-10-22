import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTableAction, createTable, startNextHand, type TableState } from '../src/poker/table.ts';
import { getLegalActions, type BettingAction } from '../src/poker/betting.ts';
import { compareHands } from '../src/poker/evaluator.ts';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

type Profile = Readonly<{ fold: number; raise: number; allIn: number }>;
// Includes all-in heavy and fold heavy mixes: the A-2 crash needed several all-ins plus a late fold.
const PROFILES: readonly Profile[] = [
  { fold: 0.04, raise: 0.22, allIn: 0.02 },
  { fold: 0.18, raise: 0.2, allIn: 0.12 },
  { fold: 0.3, raise: 0.1, allIn: 0.3 },
  { fold: 0.12, raise: 0.45, allIn: 0.25 },
];

function chooseAction(table: TableState, random: () => number, profile: Profile): { actorId: string; action: BettingAction } {
  const round = table.hand!.bettingRound!;
  assert.ok(round.actorId, 'an active hand must have an actor until it completes');
  const actor = round.players.find((player) => player.id === round.actorId)!;
  const legal = getLegalActions(round);
  const roll = random();
  let action: BettingAction;
  if (legal.canFold && roll < profile.fold) action = { type: 'fold' };
  else if (roll < profile.fold + profile.allIn && (legal.canRaise || actor.stack <= legal.callAmount)) action = { type: 'all-in' };
  else if (legal.canRaise && legal.minRaiseTo <= legal.maxRaiseTo && roll < profile.fold + profile.allIn + profile.raise) {
    const span = legal.maxRaiseTo - legal.minRaiseTo;
    const to = legal.minRaiseTo + Math.floor(random() * (span + 1));
    action = to >= legal.maxRaiseTo ? { type: 'all-in' } : { type: round.currentBet === 0 ? 'bet' : 'raise', to };
  } else if (legal.canCheck) action = { type: 'check' };
  else if (actor.stack <= legal.callAmount) action = { type: 'all-in' };
  else action = { type: 'call' };
  return { actorId: actor.id, action };
}

function assertSettlement(table: TableState, totalChips: number): void {
  const hand = table.hand!;
  assert.equal(hand.players.reduce((sum, player) => sum + player.stack, 0), totalChips, 'completed hands must preserve chips');
  if (hand.result?.type !== 'showdown') return;
  for (const pot of hand.result.settlement.pots) {
    assert.ok(pot.eligiblePlayerIds.length > 0, 'a pot must have eligible players');
    let strongest: Parameters<typeof compareHands>[0] = hand.result.settlement.hands[pot.eligiblePlayerIds[0]!]!.rank;
    for (const id of pot.eligiblePlayerIds.slice(1)) {
      const candidate = hand.result.settlement.hands[id]!.rank;
      if (compareHands(candidate, strongest) > 0) strongest = candidate;
    }
    for (const winnerId of pot.winnerIds) {
      assert.equal(compareHands(hand.result.settlement.hands[winnerId]!.rank, strongest), 0, 'each pot winner must have a strongest eligible hand');
    }
  }
}

for (const seed of [0x51a7e, 0xc0ffee, 0xbadf00d, 0x1234567]) {
  test(`fuzz seed ${seed.toString(16)}: legal play never throws, conserves chips and pays strongest hands`, () => {
    const random = seededRandom(seed);
    let completed = 0;
    for (let handIndex = 0; handIndex < 700; handIndex++) {
      const playerCount = 2 + Math.floor(random() * 7);
      const profile = PROFILES[Math.floor(random() * PROFILES.length)]!;
      // Uneven stacks make short all-ins and side pots common.
      const seats = Array.from({ length: playerCount }, (_, index) => ({ id: `p${index}`, stack: 30 + Math.floor(random() * 1_500) }));
      const totalChips = seats.reduce((sum, seat) => sum + seat.stack, 0);
      let table = startNextHand(createTable(seats, 5, 10));
      let actions = 0;
      while (table.hand?.stage !== 'complete') {
        const { actorId, action } = chooseAction(table, random, profile);
        table = applyTableAction(table, table.version, actorId, action);
        actions++;
        assert.ok(actions < 400, 'a hand must not get stuck in an action loop');
        const inPlay = table.hand!.players.reduce((sum, player) => sum + player.stack + player.totalContribution, 0);
        assert.equal(inPlay, totalChips, 'stacks and contributions must conserve chips during the hand');
      }
      assertSettlement(table, totalChips);
      completed++;
    }
    assert.equal(completed, 700);
  });
}
