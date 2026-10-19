import { createDeck, deal, shuffle, type Card } from './cards.ts';
import {
  applyBettingAction,
  createBettingRound,
  foldBettingPlayer,
  postBlind,
  type BettingAction,
  type BettingPlayer,
  type BettingRound,
} from './betting.ts';
import { resolveShowdown, type ShowdownResult } from './showdown.ts';

export type HandStage = 'preflop' | 'flop' | 'turn' | 'river' | 'complete';
export type HandSeatInput = Readonly<{ id: string; stack: number }>;
export type HandPlayer = Readonly<BettingPlayer & { holeCards: readonly [Card, Card]; blindContribution?: number }>;
export type UncalledReturn = Readonly<{ playerId: string; amount: number }>;
export type HandResult =
  | Readonly<{ type: 'showdown'; settlement: ShowdownResult; returned: UncalledReturn | null }>
  | Readonly<{ type: 'uncontested'; winnerId: string; pot: number; payouts: Readonly<Record<string, number>>; returned: UncalledReturn | null }>;

export type HandPlayerView = Readonly<{
  id: string;
  stack: number;
  streetContribution: number;
  totalContribution: number;
  folded: boolean;
  holeCards: readonly [Card, Card] | null;
}>;

export type PublicHandView = Readonly<{
  stage: HandStage;
  buttonPlayerId: string;
  smallBlind: number;
  bigBlind: number;
  board: readonly Card[];
  pot: number;
  currentBet: number;
  actorId: string | null;
  players: readonly HandPlayerView[];
  result: HandResult | null;
}>;

/** Server-only state. Never serialize this object directly to clients; it contains the undealt deck. */
export type PokerHand = Readonly<{
  players: readonly HandPlayer[];
  buttonPlayerId: string;
  smallBlind: number;
  bigBlind: number;
  stage: HandStage;
  board: readonly Card[];
  deck: readonly Card[];
  bettingRound: BettingRound | null;
  result: HandResult | null;
}>;

function validateSeatInputs(players: readonly HandSeatInput[], buttonIndex: number, smallBlind: number, bigBlind: number): void {
  if (players.length < 2) throw new RangeError('A hand requires at least two seated players');
  if (!Number.isInteger(buttonIndex) || buttonIndex < 0 || buttonIndex >= players.length) throw new RangeError('Button index is outside the table');
  if (!Number.isSafeInteger(smallBlind) || !Number.isSafeInteger(bigBlind) || smallBlind < 1 || bigBlind < smallBlind) {
    throw new RangeError('Blinds must be positive safe integers and the big blind cannot be smaller than the small blind');
  }
  const ids = new Set<string>();
  for (const player of players) {
    if (!player.id || ids.has(player.id)) throw new Error('Player IDs must be unique and non-empty');
    ids.add(player.id);
    if (!Number.isSafeInteger(player.stack) || player.stack < 1) throw new RangeError('Every dealt player must have a positive safe-integer stack');
  }
}

function nextPlayerId(players: readonly HandPlayer[], fromId: string, eligible: (player: HandPlayer) => boolean): string | null {
  const index = players.findIndex((player) => player.id === fromId);
  for (let offset = 1; offset <= players.length; offset++) {
    const player = players[(index + offset) % players.length]!;
    if (eligible(player)) return player.id;
  }
  return null;
}

function toBettingPlayers(players: readonly HandPlayer[]): BettingPlayer[] {
  return players.map(({ id, stack, streetContribution, totalContribution, folded }) => ({
    id, stack, streetContribution, totalContribution, folded,
  }));
}

function withRound(hand: PokerHand, bettingRound: BettingRound | null): PokerHand {
  if (!bettingRound) return { ...hand, bettingRound: null };
  const roundById = new Map(bettingRound.players.map((player) => [player.id, player]));
  return {
    ...hand,
    players: hand.players.map((player) => ({ ...player, ...roundById.get(player.id)! })),
    bettingRound,
  };
}

function returnUncalled(hand: PokerHand): { hand: PokerHand; returned: UncalledReturn | null } {
  const ranked = [...hand.players].sort((left, right) => right.totalContribution - left.totalContribution);
  const highest = ranked[0];
  if (!highest || highest.totalContribution === 0) return { hand, returned: null };
  const nextHighest = ranked[1]?.totalContribution ?? 0;
  const blindContribution = highest.blindContribution;
  if (!Number.isSafeInteger(blindContribution)) return { hand, returned: null };
  const amount = Math.min(highest.totalContribution - nextHighest,
    Math.max(0, highest.totalContribution - blindContribution!));
  if (amount <= 0) return { hand, returned: null };
  return {
    hand: {
      ...hand,
      players: hand.players.map((player) => player.id === highest.id
        ? { ...player, stack: player.stack + amount, totalContribution: player.totalContribution - amount,
          streetContribution: Math.max(0, player.streetContribution - amount) }
        : player),
    },
    returned: { playerId: highest.id, amount },
  };
}

function settleUncontested(hand: PokerHand, winner: HandPlayer): PokerHand {
  const refund = returnUncalled(hand);
  const adjusted = refund.hand;
  const pot = adjusted.players.reduce((sum, player) => sum + player.totalContribution, 0);
  if (!Number.isSafeInteger(pot)) throw new Error('Pot exceeds the safe integer range');
  const payouts = Object.fromEntries(adjusted.players.map((player) => [player.id, player.id === winner.id ? pot : 0]));
  return {
    ...adjusted,
    stage: 'complete',
    bettingRound: null,
    players: adjusted.players.map((player) => ({
      ...player,
      stack: player.stack + payouts[player.id]!,
      streetContribution: 0,
      totalContribution: 0,
    })),
    result: { type: 'uncontested', winnerId: winner.id, pot, payouts, returned: refund.returned },
  };
}

function settleShowdown(hand: PokerHand): PokerHand {
  const refund = returnUncalled(hand);
  const adjusted = refund.hand;
  const settlement = resolveShowdown(adjusted.players.map((player) => ({
    playerId: player.id,
    amount: player.totalContribution,
    folded: player.folded,
    holeCards: player.holeCards,
  })), adjusted.board, adjusted.buttonPlayerId);
  return {
    ...adjusted,
    stage: 'complete',
    bettingRound: null,
    players: adjusted.players.map((player) => ({
      ...player,
      stack: player.stack + settlement.payouts[player.id]!,
      streetContribution: 0,
      totalContribution: 0,
    })),
    result: { type: 'showdown', settlement, returned: refund.returned },
  };
}

function needsBettingAction(players: readonly HandPlayer[], firstActorId: string | null): boolean {
  const actionable = players.filter((player) => !player.folded && player.stack > 0);
  if (actionable.length > 1) return true;
  if (actionable.length === 0 || !firstActorId) return false;
  const actor = actionable[0]!;
  const highestOtherContribution = Math.max(0, ...players.filter((player) => player.id !== actor.id)
    .map((player) => player.totalContribution));
  return highestOtherContribution > actor.totalContribution;
}

function revealNextStreet(hand: PokerHand): PokerHand {
  const deck = [...hand.deck];
  let board = [...hand.board];
  let stage: HandStage;
  if (hand.stage === 'preflop') {
    deal(deck, 1); // Burn card before the flop.
    board = [...board, ...deal(deck, 3)];
    stage = 'flop';
  } else if (hand.stage === 'flop') {
    deal(deck, 1);
    board = [...board, ...deal(deck, 1)];
    stage = 'turn';
  } else if (hand.stage === 'turn') {
    deal(deck, 1);
    board = [...board, ...deal(deck, 1)];
    stage = 'river';
  } else {
    throw new Error('No more community cards can be dealt');
  }
  return {
    ...hand,
    players: hand.players.map((player) => ({ ...player, streetContribution: 0 })),
    board,
    deck,
    stage,
    bettingRound: null,
  };
}

/** Advances completed streets, automatically running the board when no player can act. */
function advance(hand: PokerHand): PokerHand {
  let next = hand;
  while (!next.bettingRound && !next.result) {
    const livePlayers = next.players.filter((player) => !player.folded);
    if (livePlayers.length === 1) return settleUncontested(next, livePlayers[0]!);
    if (livePlayers.length === 0) throw new Error('A hand cannot continue without a live player');
    if (next.stage === 'river') return settleShowdown(next);
    next = revealNextStreet(next);
    const firstActor = nextPlayerId(next.players, next.buttonPlayerId, (player) => !player.folded && player.stack > 0);
    if (firstActor && needsBettingAction(next.players, firstActor)) {
      const bettingRound = createBettingRound(toBettingPlayers(next.players), firstActor, next.bigBlind, 0);
      return withRound(next, bettingRound);
    }
    // Everyone remaining is all-in: reveal the rest of the board without actions.
  }
  return next;
}

export function startHand(
  seats: readonly HandSeatInput[],
  buttonIndex: number,
  smallBlind: number,
  bigBlind: number,
): PokerHand {
  validateSeatInputs(seats, buttonIndex, smallBlind, bigBlind);
  if (seats.filter((seat) => seat.stack > 0).length < 2) throw new RangeError('At least two players need chips to start a hand');
  const deck = shuffle(createDeck());
  const holeCards = new Map<string, Card[]>();
  const firstToReceive = (buttonIndex + 1) % seats.length;
  for (let cardIndex = 0; cardIndex < 2; cardIndex++) {
    for (let offset = 0; offset < seats.length; offset++) {
      const seat = seats[(firstToReceive + offset) % seats.length]!;
      const cards = holeCards.get(seat.id) ?? [];
      cards.push(...deal(deck, 1));
      holeCards.set(seat.id, cards);
    }
  }
  const players: HandPlayer[] = seats.map((seat) => ({
    id: seat.id,
    stack: seat.stack,
    streetContribution: 0,
    totalContribution: 0,
    folded: false,
    holeCards: [holeCards.get(seat.id)![0]!, holeCards.get(seat.id)![1]!] as const,
  }));
  const buttonPlayerId = seats[buttonIndex]!.id;
  const smallBlindId = seats.length === 2
    ? buttonPlayerId
    : nextPlayerId(players, buttonPlayerId, () => true)!;
  const bigBlindId = nextPlayerId(players, smallBlindId, (player) => player.id !== smallBlindId)!;
  const withSmallBlind: HandPlayer[] = players.map((player) => player.id === smallBlindId
    ? { ...postBlind(player, smallBlind), holeCards: player.holeCards }
    : player);
  const posted: HandPlayer[] = withSmallBlind.map((player) => player.id === bigBlindId
    ? { ...postBlind(player, bigBlind), holeCards: player.holeCards }
    : player);
  const withBlindContributions = posted.map((player) => ({ ...player, blindContribution: player.totalContribution }));
  const hand: PokerHand = {
    players: withBlindContributions,
    buttonPlayerId,
    smallBlind,
    bigBlind,
    stage: 'preflop',
    board: [],
    deck,
    bettingRound: null,
    result: null,
  };
  const firstActor = nextPlayerId(withBlindContributions, bigBlindId, (player) => !player.folded && player.stack > 0);
  if (firstActor && needsBettingAction(withBlindContributions, firstActor)) {
    return withRound(hand, createBettingRound(toBettingPlayers(withBlindContributions), firstActor, bigBlind, bigBlind));
  }
  return advance(hand);
}

export function applyHandAction(hand: PokerHand, playerId: string, action: BettingAction): PokerHand {
  if (!hand.bettingRound || hand.stage === 'complete') throw new Error('This hand is not accepting actions');
  const bettingRound = applyBettingAction(hand.bettingRound, playerId, action);
  const next = withRound(hand, bettingRound);
  return bettingRound.complete ? advance({ ...next, bettingRound: null }) : next;
}

/** Folds a player who left the room, even if their seat was not the current actor. */
export function foldHandPlayer(hand: PokerHand, playerId: string): PokerHand {
  if (!hand.bettingRound || hand.stage === 'complete') return hand;
  const bettingRound = foldBettingPlayer(hand.bettingRound, playerId);
  const next = withRound(hand, bettingRound);
  return bettingRound.complete ? advance({ ...next, bettingRound: null }) : next;
}

export function getHandPot(hand: PokerHand): number {
  return hand.players.reduce((sum, player) => sum + player.totalContribution, 0);
}

/** Builds a client-safe view and never includes the undealt deck or another live player's cards. */
export function getPublicHandView(hand: PokerHand, viewerId?: string): PublicHandView {
  const revealedHands = hand.result?.type === 'showdown' ? hand.result.settlement.hands : undefined;
  return {
    stage: hand.stage,
    buttonPlayerId: hand.buttonPlayerId,
    smallBlind: hand.smallBlind,
    bigBlind: hand.bigBlind,
    board: [...hand.board],
    pot: getHandPot(hand),
    currentBet: hand.bettingRound?.currentBet ?? 0,
    actorId: hand.bettingRound?.actorId ?? null,
    players: hand.players.map((player) => ({
      id: player.id,
      stack: player.stack,
      streetContribution: player.streetContribution,
      totalContribution: player.totalContribution,
      folded: player.folded,
      holeCards: player.id === viewerId || (revealedHands && player.id in revealedHands) ? player.holeCards : null,
    })),
    result: hand.result,
  };
}
