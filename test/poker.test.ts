import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck, deal, shuffle, type Card } from '../src/poker/cards.ts';
import { compareHands, evaluateHand } from '../src/poker/evaluator.ts';
import { buildPots, splitPot } from '../src/poker/pots.ts';
import { applyBettingAction, createBettingRound, getLegalActions, postBlind, type BettingPlayer } from '../src/poker/betting.ts';
import { resolveShowdown } from '../src/poker/showdown.ts';
import { applyHandAction, getHandPot, getPublicHandView, startHand } from '../src/poker/hand.ts';
import { applyTableAction, createTable, getPublicTableView, startNextHand } from '../src/poker/table.ts';
import { createGuestCredential, createRoom, finishRoomGame, joinRoom, leaveRoom, listPublicRooms, startRoomGame, verifyGuestSession } from '../src/poker/rooms.ts';

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

const player = (id: string, stack = 100, streetContribution = 0): BettingPlayer => ({
  id, stack, streetContribution, totalContribution: streetContribution, folded: false,
});

test('posts short blinds and completes a check-through street in order', () => {
  const shortBlind = postBlind(player('sb', 3), 5);
  assert.deepEqual(shortBlind, { id: 'sb', stack: 0, streetContribution: 3, totalContribution: 3, folded: false });
  let round = createBettingRound([player('a'), player('b'), player('c')], 'a', 10);
  assert.equal(getLegalActions(round).canCheck, true);
  round = applyBettingAction(round, 'a', { type: 'check' });
  assert.equal(round.actorId, 'b');
  round = applyBettingAction(round, 'b', { type: 'check' });
  round = applyBettingAction(round, 'c', { type: 'check' });
  assert.equal(round.complete, true);
});

test('does not allow a player to raise when every opponent is all-in', () => {
  const round = createBettingRound([player('acting', 100), player('all-in', 0, 10)], 'acting', 10);
  assert.equal(getLegalActions(round).canRaise, false);
  assert.equal(getLegalActions(round).canCheck, false);
  assert.equal(getLegalActions(round).callAmount, 10);
});

test('enforces call, minimum raise, and returns action after a full raise', () => {
  let round = createBettingRound([player('a'), player('b'), player('c')], 'a', 10);
  round = applyBettingAction(round, 'a', { type: 'bet', to: 10 });
  assert.equal(round.actorId, 'b');
  assert.equal(getLegalActions(round).callAmount, 10);
  assert.throws(() => applyBettingAction(round, 'b', { type: 'raise', to: 15 }), /minimum raise/);
  round = applyBettingAction(round, 'b', { type: 'raise', to: 20 });
  assert.equal(round.minRaise, 10);
  assert.equal(round.actorId, 'c');
  round = applyBettingAction(round, 'c', { type: 'call' });
  assert.equal(round.actorId, 'a');
  round = applyBettingAction(round, 'a', { type: 'call' });
  assert.equal(round.complete, true);
  assert.deepEqual(round.players.map((p) => [p.id, p.stack, p.streetContribution]), [['a', 80, 20], ['b', 80, 20], ['c', 80, 20]]);
});

test('allows a short all-in raise without reopening raises for players who acted', () => {
  let round = createBettingRound([player('a', 100), player('b', 14), player('c', 100)], 'a', 10);
  round = applyBettingAction(round, 'a', { type: 'bet', to: 10 });
  round = applyBettingAction(round, 'b', { type: 'all-in' });
  assert.equal(round.currentBet, 14);
  assert.equal(round.actorId, 'c');
  round = applyBettingAction(round, 'c', { type: 'call' });
  assert.equal(round.actorId, 'a');
  assert.equal(getLegalActions(round, 'a').canRaise, false);
  assert.throws(() => applyBettingAction(round, 'a', { type: 'raise', to: 30 }), /not currently allowed/);
  round = applyBettingAction(round, 'a', { type: 'call' });
  assert.equal(round.complete, true);
  assert.equal(round.players.find((p) => p.id === 'b')?.totalContribution, 14);
});

test('ends the hand when all opponents fold', () => {
  let round = createBettingRound([player('a'), player('b'), player('c')], 'a', 10);
  round = applyBettingAction(round, 'a', { type: 'bet', to: 10 });
  round = applyBettingAction(round, 'b', { type: 'fold' });
  round = applyBettingAction(round, 'c', { type: 'fold' });
  assert.equal(round.complete, true);
  assert.equal(round.actorId, null);
});

test('settles main and side pots using eligible hands and returns every chip', () => {
  const board = [c(2,'clubs'), c(4,'diamonds'), c(6,'hearts'), c(8,'spades'), c(10,'clubs')];
  const result = resolveShowdown([
    { playerId: 'a', amount: 100, folded: false, holeCards: [c(13,'hearts'), c(13,'spades')] },
    { playerId: 'b', amount: 60, folded: false, holeCards: [c(14,'hearts'), c(14,'spades')] },
    { playerId: 'c', amount: 100, folded: true, holeCards: [c(12,'hearts'), c(12,'spades')] },
  ], board, 'a');
  assert.equal(result.totalPot, 260);
  assert.deepEqual(result.payouts, { a: 80, b: 180, c: 0 });
  assert.deepEqual(result.pots.map((pot) => pot.winnerIds), [['b'], ['a']]);
  assert.equal(result.hands.c, undefined);
});

test('rejects a duplicate card across players or the board at showdown', () => {
  assert.throws(() => resolveShowdown([
    { playerId: 'a', amount: 1, folded: false, holeCards: [c(14,'clubs'), c(13,'clubs')] },
    { playerId: 'b', amount: 1, folded: false, holeCards: [c(14,'clubs'), c(12,'clubs')] },
  ], [c(2,'clubs'),c(3,'clubs'),c(4,'clubs'),c(5,'clubs'),c(6,'clubs')], 'a'), /Duplicate card/);
});

test('plays a complete heads-up hand across all four betting streets', () => {
  let hand = startHand([{ id: 'button', stack: 100 }, { id: 'big-blind', stack: 100 }], 0, 5, 10);
  assert.equal(hand.stage, 'preflop');
  assert.equal(hand.bettingRound?.actorId, 'button');
  hand = applyHandAction(hand, 'button', { type: 'call' });
  hand = applyHandAction(hand, 'big-blind', { type: 'check' });
  assert.equal(hand.stage, 'flop');
  assert.equal(hand.board.length, 3);
  for (const stage of ['flop', 'turn', 'river'] as const) {
    assert.equal(hand.stage, stage);
    while (hand.stage === stage) {
      const actorId = hand.bettingRound?.actorId;
      assert.ok(actorId);
      hand = applyHandAction(hand, actorId, { type: 'check' });
    }
  }
  assert.equal(hand.stage, 'complete');
  assert.equal(hand.board.length, 5);
  assert.equal(hand.result?.type, 'showdown');
  assert.equal(hand.players.reduce((sum, player) => sum + player.stack, 0), 200);
});

test('posts multiway blinds and gives the big blind its preflop option', () => {
  let hand = startHand([
    { id: 'button', stack: 100 },
    { id: 'small-blind', stack: 100 },
    { id: 'big-blind', stack: 100 },
  ], 0, 5, 10);
  assert.equal(hand.players.find((p) => p.id === 'small-blind')?.streetContribution, 5);
  assert.equal(hand.players.find((p) => p.id === 'big-blind')?.streetContribution, 10);
  assert.equal(hand.bettingRound?.actorId, 'button');
  hand = applyHandAction(hand, 'button', { type: 'call' });
  hand = applyHandAction(hand, 'small-blind', { type: 'call' });
  assert.equal(hand.bettingRound?.actorId, 'big-blind');
  hand = applyHandAction(hand, 'big-blind', { type: 'check' });
  assert.equal(hand.stage, 'flop');
  assert.equal(hand.bettingRound?.actorId, 'small-blind');
});

test('runs out the board when both players are all-in from the blinds', () => {
  const hand = startHand([{ id: 'button', stack: 5 }, { id: 'big-blind', stack: 5 }], 0, 5, 10);
  assert.equal(hand.stage, 'complete');
  assert.equal(hand.board.length, 5);
  assert.equal(hand.result?.type, 'showdown');
  assert.equal(hand.result?.type === 'showdown' ? hand.result.settlement.totalPot : 0, 10);
  assert.equal(hand.players.reduce((sum, player) => sum + player.stack, 0), 10);
});

test('public hand views hide opponents’ cards and the undealt deck', () => {
  const hand = startHand([{ id: 'button', stack: 100 }, { id: 'big-blind', stack: 100 }], 0, 5, 10);
  const view = getPublicHandView(hand, 'button');
  assert.deepEqual(view.players.find((p) => p.id === 'button')?.holeCards, hand.players[0]?.holeCards);
  assert.equal(view.players.find((p) => p.id === 'big-blind')?.holeCards, null);
  assert.equal('deck' in view, false);
  assert.equal(JSON.stringify(view).includes(JSON.stringify(hand.deck)), false);
});

test('awards the pot immediately after every opponent folds', () => {
  let hand = startHand([{ id: 'button', stack: 100 }, { id: 'small-blind', stack: 100 }, { id: 'big-blind', stack: 100 }], 0, 5, 10);
  hand = applyHandAction(hand, 'button', { type: 'fold' });
  hand = applyHandAction(hand, 'small-blind', { type: 'fold' });
  assert.equal(hand.stage, 'complete');
  assert.deepEqual(hand.result, { type: 'uncontested', winnerId: 'big-blind', pot: 15, payouts: { button: 0, 'small-blind': 0, 'big-blind': 15 } });
  assert.equal(getHandPot(hand), 0);
  assert.equal(hand.players.reduce((sum, player) => sum + player.stack, 0), 300);
});

test('rotates the button clockwise and skips seats with no chips', () => {
  let table = createTable([
    { id: 'a', stack: 100 },
    { id: 'b', stack: 0 },
    { id: 'c', stack: 100 },
    { id: 'd', stack: 100 },
  ], 5, 10);
  table = startNextHand(table);
  assert.equal(table.buttonPlayerId, 'a');
  assert.equal(table.handNumber, 1);
  assert.equal(table.hand?.bettingRound?.actorId, 'a');
  assert.throws(() => startNextHand(table), /must finish/);
  table = applyTableAction(table, table.version, 'a', { type: 'fold' });
  table = applyTableAction(table, table.version, 'c', { type: 'fold' });
  assert.equal(table.hand?.stage, 'complete');
  assert.throws(() => applyTableAction(table, 1, 'd', { type: 'check' }), /Stale table version/);
  table = startNextHand(table);
  assert.equal(table.buttonPlayerId, 'c');
  assert.equal(table.handNumber, 2);
  assert.deepEqual(table.seats.map((seat) => seat.id), ['a', 'b', 'c', 'd']);
  assert.equal(getPublicTableView(table).hand?.players.find((player) => player.id === 'd')?.holeCards, null);
});

test('guest credentials store only a verifier and reject invalid tokens', () => {
  const { credential, session } = createGuestCredential('  Alice  ');
  assert.equal(credential.displayName, 'Alice');
  assert.equal(verifyGuestSession(session, credential.sessionToken), true);
  assert.equal(verifyGuestSession(session, 'not-the-session-token'), false);
  assert.equal('sessionToken' in session, false);
  assert.throws(() => createGuestCredential(''), /Display names/);
});

test('creates invite rooms without credentials in the URL and enforces seats', () => {
  const host = createGuestCredential('Host').credential;
  const guest = createGuestCredential('Guest').credential;
  const extra = createGuestCredential('Extra').credential;
  const { room: created, invitationPath } = createRoom(host, {
    visibility: 'private', maxPlayers: 2, startingStack: 500, smallBlind: 5, bigBlind: 10,
  });
  assert.equal(invitationPath, `/rooms/${created.id}`);
  assert.equal(invitationPath.includes(host.sessionToken), false);
  const joined = joinRoom(created, guest);
  assert.equal(joined.joinedAs, 'player');
  assert.throws(() => joinRoom(joined.room, extra), /full/);
  const spectator = joinRoom(joined.room, extra, 'spectator');
  assert.equal(spectator.joinedAs, 'spectator');
  assert.equal(spectator.room.members.find((member) => member.guestId === extra.guestId)?.seat, null);
});

test('starts public rooms with host permissions, admits late spectators, and hands off host', () => {
  const host = createGuestCredential('Host').credential;
  const guest = createGuestCredential('Guest').credential;
  const late = createGuestCredential('Late').credential;
  let room = createRoom(host, {
    visibility: 'public', maxPlayers: 6, startingStack: 100, smallBlind: 1, bigBlind: 2,
  }).room;
  room = joinRoom(room, guest).room;
  assert.throws(() => startRoomGame(room, guest.guestId, room.version), /Only the room host/);
  room = startRoomGame(room, host.guestId, room.version);
  assert.equal(joinRoom(room, late).joinedAs, 'spectator');
  room = joinRoom(room, late).room;
  room = leaveRoom(room, host.guestId);
  assert.equal(room.hostGuestId, guest.guestId);
  assert.equal(room.members.find((member) => member.guestId === host.guestId)?.connected, false);
  assert.deepEqual(listPublicRooms([room]).map((summary) => [summary.playerCount, summary.spectatorCount, summary.availableSeats]), [[2, 1, 0]]);
  room = joinRoom(room, host).room;
  assert.equal(room.members.find((member) => member.guestId === host.guestId)?.connected, true);
  room = finishRoomGame(room, room.version);
  assert.equal(room.status, 'waiting');
  assert.throws(() => finishRoomGame(room, room.version - 1), /Stale room version/);
});
