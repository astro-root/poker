import type { BettingAction } from './betting.ts';
import { applyHandAction, getPublicHandView, startHand, type PokerHand, type PublicHandView } from './hand.ts';

export type TableSeat = Readonly<{ id: string; stack: number }>;
export type TableState = Readonly<{
  seats: readonly TableSeat[];
  smallBlind: number;
  bigBlind: number;
  baseSmallBlind: number;
  baseBigBlind: number;
  buttonPlayerId: string | null;
  handNumber: number;
  version: number;
  hand: PokerHand | null;
}>;

function validateSeats(seats: readonly TableSeat[]): void {
  if (seats.length < 2 || seats.length > 10) throw new RangeError('A table supports two to ten seats');
  const ids = new Set<string>();
  for (const seat of seats) {
    if (!seat.id || ids.has(seat.id)) throw new Error('Seat IDs must be unique and non-empty');
    ids.add(seat.id);
    if (!Number.isSafeInteger(seat.stack) || seat.stack < 0) throw new RangeError('Stacks must be non-negative safe integers');
  }
  if (seats.filter((seat) => seat.stack > 0).length < 2) throw new RangeError('At least two seated players need chips');
}

export function createTable(seats: readonly TableSeat[], smallBlind: number, bigBlind: number): TableState {
  validateSeats(seats);
  if (!Number.isSafeInteger(smallBlind) || !Number.isSafeInteger(bigBlind) || smallBlind < 1 || bigBlind < smallBlind) {
    throw new RangeError('Blinds must be positive safe integers and the big blind cannot be smaller than the small blind');
  }
  return {
    seats: seats.map((seat) => ({ ...seat })),
    smallBlind,
    bigBlind,
    baseSmallBlind: smallBlind,
    baseBigBlind: bigBlind,
    buttonPlayerId: null,
    handNumber: 0,
    version: 0,
    hand: null,
  };
}

function nextFundedButton(seats: readonly TableSeat[], previousButtonId: string | null): string {
  const startIndex = previousButtonId === null ? -1 : seats.findIndex((seat) => seat.id === previousButtonId);
  if (previousButtonId !== null && startIndex < 0) throw new Error('Previous button is not seated at this table');
  for (let offset = 1; offset <= seats.length; offset++) {
    const seat = seats[(startIndex + offset) % seats.length]!;
    if (seat.stack > 0) return seat.id;
  }
  throw new Error('No players have chips');
}

function synchronizeStacks(table: TableState, hand: PokerHand): TableSeat[] {
  const stacks = new Map(hand.players.map((player) => [player.id, player.stack]));
  return table.seats.map((seat) => ({ ...seat, stack: stacks.get(seat.id) ?? seat.stack }));
}

/** Starts the next hand and moves the button clockwise, skipping empty seats. */
export function startNextHand(table: TableState): TableState {
  if (table.hand && table.hand.stage !== 'complete') throw new Error('The current hand must finish before another starts');
  const seats = table.hand ? synchronizeStacks(table, table.hand) : table.seats.map((seat) => ({ ...seat }));
  validateSeats(seats);
  const buttonPlayerId = nextFundedButton(seats, table.buttonPlayerId);
  const participants = seats.filter((seat) => seat.stack > 0);
  const buttonIndex = participants.findIndex((seat) => seat.id === buttonPlayerId);
  const nextHandNumber = table.handNumber + 1;
  const level = Math.floor((nextHandNumber - 1) / 10);
  const smallBlind = table.baseSmallBlind * 2 ** level;
  const bigBlind = table.baseBigBlind * 2 ** level;
  if (!Number.isSafeInteger(smallBlind) || !Number.isSafeInteger(bigBlind)) throw new RangeError('Blind level exceeds the safe integer range');
  const hand = startHand(participants, buttonIndex, smallBlind, bigBlind);
  return {
    ...table,
    seats,
    smallBlind,
    bigBlind,
    buttonPlayerId,
    handNumber: nextHandNumber,
    version: table.version + 1,
    hand,
  };
}

/** Applies an action only against the current table version to reject stale client state. */
export function applyTableAction(
  table: TableState,
  expectedVersion: number,
  playerId: string,
  action: BettingAction,
): TableState {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== table.version) {
    throw new Error('Stale table version; fetch the latest table state');
  }
  if (!table.hand) throw new Error('No hand is in progress');
  const hand = applyHandAction(table.hand, playerId, action);
  return {
    ...table,
    seats: synchronizeStacks(table, hand),
    hand,
    version: table.version + 1,
  };
}

export function getPublicTableView(table: TableState, viewerId?: string): Readonly<{
  seats: readonly TableSeat[];
  smallBlind: number;
  bigBlind: number;
  buttonPlayerId: string | null;
  handNumber: number;
  version: number;
  hand: PublicHandView | null;
}> {
  return {
    seats: table.seats.map((seat) => ({ ...seat })),
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
    buttonPlayerId: table.buttonPlayerId,
    handNumber: table.handNumber,
    version: table.version,
    hand: table.hand ? getPublicHandView(table.hand, viewerId) : null,
  };
}
