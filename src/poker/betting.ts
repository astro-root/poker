export type BettingPlayer = Readonly<{
  id: string;
  stack: number;
  streetContribution: number;
  totalContribution: number;
  folded: boolean;
}>;

export type BettingAction =
  | Readonly<{ type: 'fold' }>
  | Readonly<{ type: 'check' }>
  | Readonly<{ type: 'call' }>
  | Readonly<{ type: 'bet' | 'raise'; to: number }>
  | Readonly<{ type: 'all-in' }>;

export type BettingRound = Readonly<{
  players: readonly BettingPlayer[];
  currentBet: number;
  minRaise: number;
  actorId: string | null;
  pendingPlayerIds: readonly string[];
  raiseAllowedPlayerIds: readonly string[];
  complete: boolean;
}>;

export type LegalActions = Readonly<{
  canFold: boolean;
  canCheck: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
}>;

function validatePlayers(players: readonly BettingPlayer[]): void {
  if (players.length < 2) throw new RangeError('A betting round needs at least two players');
  const ids = new Set<string>();
  for (const player of players) {
    if (!player.id || ids.has(player.id)) throw new Error('Player IDs must be unique and non-empty');
    ids.add(player.id);
    for (const amount of [player.stack, player.streetContribution, player.totalContribution]) {
      if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('Chip amounts must be non-negative safe integers');
    }
    if (player.totalContribution < player.streetContribution) throw new Error('Total contribution cannot be below street contribution');
  }
}

/** Starts a street. firstActorId is selected by the game engine based on button/blind positions. */
export function createBettingRound(
  players: readonly BettingPlayer[],
  firstActorId: string,
  minimumBet: number,
  openingBet = 0,
): BettingRound {
  validatePlayers(players);
  if (!Number.isSafeInteger(minimumBet) || minimumBet < 1) throw new RangeError('Minimum bet must be a positive safe integer');
  if (!Number.isSafeInteger(openingBet) || openingBet < 0) throw new RangeError('Opening bet must be a non-negative safe integer');
  const first = players.find((player) => player.id === firstActorId);
  if (!first || first.folded || first.stack === 0) throw new Error('First actor must be able to act');
  const currentBet = Math.max(openingBet, ...players.map((player) => player.streetContribution));
  const canAct = players.filter((player) => !player.folded && player.stack > 0);
  return {
    players: players.map((player) => ({ ...player })),
    currentBet,
    minRaise: minimumBet,
    actorId: firstActorId,
    pendingPlayerIds: canAct.map((player) => player.id),
    raiseAllowedPlayerIds: canAct.map((player) => player.id),
    complete: false,
  };
}

export function getLegalActions(round: BettingRound, playerId = round.actorId): LegalActions {
  if (round.complete || !playerId || playerId !== round.actorId) throw new Error('It is not this player’s turn');
  const player = round.players.find((candidate) => candidate.id === playerId);
  if (!player || player.folded || player.stack === 0) throw new Error('Player cannot act');
  const callAmount = Math.min(round.currentBet - player.streetContribution, player.stack);
  const maxRaiseTo = player.streetContribution + player.stack;
  const hasCallableOpponent = round.players.some((candidate) => candidate.id !== playerId && !candidate.folded && candidate.stack > 0);
  const canRaise = hasCallableOpponent && round.raiseAllowedPlayerIds.includes(playerId) && maxRaiseTo > round.currentBet;
  return {
    canFold: true,
    canCheck: callAmount === 0,
    callAmount,
    canRaise,
    minRaiseTo: round.currentBet === 0 ? round.minRaise : round.currentBet + round.minRaise,
    maxRaiseTo,
  };
}

function nextActor(players: readonly BettingPlayer[], pending: readonly string[], afterId: string): string | null {
  for (let offset = 1; offset <= players.length; offset++) {
    const id = players[(players.findIndex((player) => player.id === afterId) + offset) % players.length]!.id;
    if (pending.includes(id)) return id;
  }
  return null;
}

function finishOrAdvance(
  players: BettingPlayer[],
  pending: string[],
  raiseAllowed: string[],
  currentBet: number,
  minRaise: number,
  actedId: string,
): BettingRound {
  const live = players.filter((player) => !player.folded);
  const eligiblePending = pending.filter((id) => {
    const player = players.find((candidate) => candidate.id === id)!;
    return !player.folded && player.stack > 0;
  });
  const complete = live.length <= 1 || eligiblePending.length === 0;
  const actorId = complete ? null : nextActor(players, eligiblePending, actedId);
  return {
    players,
    currentBet,
    minRaise,
    actorId,
    pendingPlayerIds: eligiblePending,
    raiseAllowedPlayerIds: raiseAllowed.filter((id) => eligiblePending.includes(id)),
    complete: complete || actorId === null,
  };
}

/** Applies one validated action immutably. Raise `to` values are street-total contributions. */
export function applyBettingAction(round: BettingRound, playerId: string, action: BettingAction): BettingRound {
  if (round.complete || round.actorId !== playerId) throw new Error('Out-of-turn or completed betting action');
  const index = round.players.findIndex((player) => player.id === playerId);
  const current = round.players[index];
  if (!current || current.folded || current.stack === 0) throw new Error('Player cannot act');
  const legal = getLegalActions(round, playerId);
  let updated: BettingPlayer = { ...current };
  let currentBet = round.currentBet;
  let minRaise = round.minRaise;
  let pending = round.pendingPlayerIds.filter((id) => id !== playerId);
  let raiseAllowed = round.raiseAllowedPlayerIds.filter((id) => id !== playerId);

  const commitTo = (target: number): void => {
    if (!Number.isSafeInteger(target) || target <= current.streetContribution || target > legal.maxRaiseTo) {
      throw new RangeError('Contribution target is outside the player’s legal chip range');
    }
    const increase = target - current.streetContribution;
    updated = {
      ...current,
      stack: current.stack - increase,
      streetContribution: target,
      totalContribution: current.totalContribution + increase,
    };
  };

  switch (action.type) {
    case 'fold':
      updated = { ...current, folded: true };
      break;
    case 'check':
      if (!legal.canCheck) throw new Error('Cannot check while facing a bet');
      break;
    case 'call':
      if (legal.callAmount === 0) throw new Error('Nothing to call; check instead');
      commitTo(current.streetContribution + legal.callAmount);
      break;
    case 'bet':
    case 'raise': {
      if (!legal.canRaise) throw new Error('Betting or raising is not currently allowed');
      const target = action.to;
      if (target <= round.currentBet) throw new RangeError('A bet or raise must increase the current bet');
      const increase = target - round.currentBet;
      const isAllIn = target === legal.maxRaiseTo;
      if (increase < round.minRaise && !isAllIn) throw new RangeError('Raise is below the minimum raise');
      if (round.currentBet === 0 && action.type !== 'bet') throw new Error('Use bet when no bet has been made');
      if (round.currentBet > 0 && action.type !== 'raise') throw new Error('Use raise when facing a bet');
      commitTo(target);
      currentBet = target;
      if (increase >= round.minRaise) {
        minRaise = increase;
        pending = round.players.filter((player) => player.id !== playerId && !player.folded && player.stack > 0).map((player) => player.id);
        raiseAllowed = [...pending];
      } else {
        pending = [...new Set([...pending, ...round.players
          .filter((player) => player.id !== playerId && !player.folded && player.stack > 0 && player.streetContribution < target)
          .map((player) => player.id)])];
      }
      break;
    }
    case 'all-in': {
      const target = legal.maxRaiseTo;
      if (target <= current.streetContribution) throw new Error('Player has no chips to move all-in');
      if (target > round.currentBet && !legal.canRaise) throw new Error('Player cannot raise again before a full raise');
      if (target > round.currentBet) {
        const increase = target - round.currentBet;
        if (increase >= round.minRaise) {
          currentBet = target;
          minRaise = increase;
          pending = round.players.filter((player) => player.id !== playerId && !player.folded && player.stack > 0).map((player) => player.id);
          raiseAllowed = [...pending];
        } else {
          currentBet = target;
          pending = [...new Set([...pending, ...round.players
            .filter((player) => player.id !== playerId && !player.folded && player.stack > 0 && player.streetContribution < target)
            .map((player) => player.id)])];
        }
      }
      commitTo(target);
      break;
    }
    default: {
      const exhaustiveCheck: never = action;
      throw new Error(`Unknown betting action: ${String(exhaustiveCheck)}`);
    }
  }

  const players = round.players.map((player, playerIndex) => playerIndex === index ? updated : { ...player });
  // A full raise grants action and raise rights to every other live player; a short all-in
  // only brings players who owe chips back into the action queue.
  return finishOrAdvance(players, pending, raiseAllowed, currentBet, minRaise, playerId);
}

/** Posts a blind, including a short blind when the player is all-in. */
export function postBlind(player: BettingPlayer, nominalAmount: number): BettingPlayer {
  if (!Number.isSafeInteger(nominalAmount) || nominalAmount < 0) throw new RangeError('Blind must be a non-negative safe integer');
  if (!Number.isSafeInteger(player.stack) || player.stack < 0) throw new RangeError('Invalid stack');
  const paid = Math.min(player.stack, nominalAmount);
  return {
    ...player,
    stack: player.stack - paid,
    streetContribution: player.streetContribution + paid,
    totalContribution: player.totalContribution + paid,
  };
}
