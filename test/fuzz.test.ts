import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTableAction, createTable, startNextHand } from '../src/poker/table.ts';
import { getLegalActions } from '../src/poker/betting.ts';
import { compareHands } from '../src/poker/evaluator.ts';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test('fixed-seed legal play conserves chips, advances, and awards every pot to a strongest hand', () => {
  const random = seededRandom(0x51a7e);
  const totalChips = 4_000;
  let completedHands = 0;

  for (let handIndex = 0; handIndex < 160; handIndex++) {
    let table = startNextHand(createTable([
      { id: 'a', stack: 1_000 }, { id: 'b', stack: 1_000 },
      { id: 'c', stack: 1_000 }, { id: 'd', stack: 1_000 },
    ], 5, 10));
    let actions = 0;
    while (table.hand?.stage !== 'complete') {
      const round = table.hand?.bettingRound;
      assert.ok(round?.actorId, 'an active hand must have an actor until it completes');
      const actor = round.players.find((player) => player.id === round.actorId)!;
      const legal = getLegalActions(round);
      const roll = random();
      let action;
      const otherLive = round.players.filter((player) => player.id !== actor.id && !player.folded);
      const actorIsUniqueHighContributor = actor.totalContribution > Math.max(...otherLive.map((player) => player.totalContribution));
      if (roll < 0.04 && !actorIsUniqueHighContributor) {
        action = { type: 'fold' as const };
      } else if (legal.canRaise && legal.minRaiseTo <= legal.maxRaiseTo && roll < 0.26) {
        const span = legal.maxRaiseTo - legal.minRaiseTo;
        action = { type: round.currentBet === 0 ? 'bet' as const : 'raise' as const,
          to: legal.minRaiseTo + Math.floor(random() * (span + 1)) };
      } else if (legal.canCheck) {
        action = { type: 'check' as const };
      } else if (actor.stack < legal.callAmount || (actor.stack <= legal.callAmount && roll < 0.12)) {
        action = { type: 'all-in' as const };
      } else {
        action = { type: 'call' as const };
      }
      table = applyTableAction(table, table.version, actor.id, action);
      actions++;
      assert.ok(actions < 300, 'a hand must not get stuck in an action loop');
      const chipsInPlay = table.hand!.players.reduce((sum, player) => sum + player.stack + player.totalContribution, 0);
      assert.equal(chipsInPlay, totalChips, 'stacks and contributions must conserve chips during the hand');
    }

    const hand = table.hand!;
    const finalStacks = hand.players.reduce((sum, player) => sum + player.stack, 0);
    assert.equal(finalStacks, totalChips, 'completed hands must preserve the table chip total');
    if (hand.result?.type === 'showdown') {
      const settlement = hand.result.settlement;
      for (const pot of settlement.pots) {
        let strongest = settlement.hands[pot.eligiblePlayerIds[0]!]!.rank;
        for (const id of pot.eligiblePlayerIds.slice(1)) {
          const candidate = settlement.hands[id]!.rank;
          if (compareHands(candidate, strongest) > 0) strongest = candidate;
        }
        for (const winnerId of pot.winnerIds) {
          assert.equal(compareHands(settlement.hands[winnerId]!.rank, strongest), 0,
            'each pot winner must have a strongest eligible hand');
        }
      }
    }
    completedHands++;
  }

  assert.equal(completedHands, 160);
});
