import type { BettingAction } from './betting.ts';
import { applyHandAction, getPublicHandView, startHand, type PokerHand, type PublicHandView } from './hand.ts';

export type TableSeat = Readonly<{ id: string; stack: number }>;
export type TableState = Readonly<{
  seats: readonly TableSeat[];
  smallBlind: number;
  bigBlind: number;
  baseSmallBlind: number;
  baseBigBlind: number;
  ante: number;
  baseAnte: number;
  /** Hands to play, or null for unlimited. */
  maxHands: number | null;
  /** Whether blinds and ante double every 10 hands. */
  escalateBlinds: boolean;
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

export type TableOptions = Readonly<{ ante?: number; maxHands?: number | null; escalateBlinds?: boolean }>;
/** Doubling stops here so blinds can never leave the safe-integer range. */
export const MAX_BLIND_LEVEL = 12;

export function createTable(seats: readonly TableSeat[], smallBlind: number, bigBlind: number, options: TableOptions = {}): TableState {
  validateSeats(seats);
  const ante = options.ante ?? 0;
  const maxHands = options.maxHands ?? null;
  if (!Number.isSafeInteger(ante) || ante < 0) throw new RangeError('Ante must be a non-negative safe integer');
  if (maxHands !== null && (!Number.isSafeInteger(maxHands) || maxHands < 1)) throw new RangeError('Hand limit must be a positive safe integer or null');
  if (!Number.isSafeInteger(smallBlind) || !Number.isSafeInteger(bigBlind) || smallBlind < 1 || bigBlind < smallBlind) {
    throw new RangeError('Blinds must be positive safe integers and the big blind cannot be smaller than the small blind');
  }
  return {
    seats: seats.map((seat) => ({ ...seat })),
    smallBlind,
    bigBlind,
    baseSmallBlind: smallBlind,
    baseBigBlind: bigBlind,
    ante,
    baseAnte: ante,
    maxHands,
    escalateBlinds: options.escalateBlinds ?? true,
    buttonPlayerId: null,
    handNumber: 0,
    version: 0,
    hand: null,
  };
}

export type SittingOut = ReadonlySet<string> | readonly string[];

function toSet(sittingOut: SittingOut): ReadonlySet<string> {
  return sittingOut instanceof Set ? sittingOut : new Set(sittingOut);
}

function nextFundedButton(seats: readonly TableSeat[], previousButtonId: string | null, away: ReadonlySet<string>): string {
  const startIndex = previousButtonId === null ? -1 : seats.findIndex((seat) => seat.id === previousButtonId);
  if (previousButtonId !== null && startIndex < 0) throw new Error('Previous button is not seated at this table');
  for (let offset = 1; offset <= seats.length; offset++) {
    const seat = seats[(startIndex + offset) % seats.length]!;
    if (seat.stack > 0 && !away.has(seat.id)) return seat.id;
  }
  throw new Error('No players have chips');
}

function synchronizeStacks(table: TableState, hand: PokerHand): TableSeat[] {
  const stacks = new Map(hand.players.map((player) => [player.id, player.stack]));
  return table.seats.map((seat) => ({ ...seat, stack: stacks.get(seat.id) ?? seat.stack }));
}

/**
 * Starts the next hand and moves the button clockwise, skipping empty seats.
 * Seats listed in `sittingOut` keep their chips and position but are not dealt in,
 * do not post blinds, and cannot hold the button until they return.
 */
export function startNextHand(table: TableState, sittingOut: SittingOut = []): TableState {
  if (table.hand && table.hand.stage !== 'complete') throw new Error('The current hand must finish before another starts');
  if (table.maxHands !== null && table.maxHands !== undefined && table.handNumber >= table.maxHands) throw new Error('The hand limit has been reached');
  const seats = table.hand ? synchronizeStacks(table, table.hand) : table.seats.map((seat) => ({ ...seat }));
  validateSeats(seats);
  const away = toSet(sittingOut);
  const participants = seats.filter((seat) => seat.stack > 0 && !away.has(seat.id));
  if (participants.length < 2) throw new RangeError('At least two present players need chips');
  const buttonPlayerId = nextFundedButton(seats, table.buttonPlayerId, away);
  const buttonIndex = participants.findIndex((seat) => seat.id === buttonPlayerId);
  const nextHandNumber = table.handNumber + 1;
  const level = table.escalateBlinds === false ? 0 : Math.min(MAX_BLIND_LEVEL, Math.floor((nextHandNumber - 1) / 10));
  const smallBlind = table.baseSmallBlind * 2 ** level;
  const bigBlind = table.baseBigBlind * 2 ** level;
  const ante = (table.baseAnte ?? 0) * 2 ** level;
  if (!Number.isSafeInteger(smallBlind) || !Number.isSafeInteger(bigBlind) || !Number.isSafeInteger(ante)) throw new RangeError('Blind level exceeds the safe integer range');
  const hand = startHand(participants, buttonIndex, smallBlind, bigBlind, ante);
  return {
    ...table,
    seats,
    smallBlind,
    bigBlind,
    ante,
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

/** True when the finished hand ends the game: one player holds every chip, or the hand limit was just played. */
export function isGameOver(table: TableState): boolean {
  if (table.hand?.stage !== 'complete') return false;
  if (table.seats.filter((seat) => seat.stack > 0).length <= 1) return true;
  return table.maxHands !== null && table.maxHands !== undefined && table.handNumber >= table.maxHands;
}

export function getPublicTableView(table: TableState, viewerId?: string): Readonly<{
  seats: readonly TableSeat[];
  smallBlind: number;
  bigBlind: number;
  ante: number;
  buttonPlayerId: string | null;
  handNumber: number;
  version: number;
  hand: PublicHandView | null;
}> {
  return {
    seats: table.seats.map((seat) => ({ ...seat })),
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
    ante: table.ante ?? 0,
    buttonPlayerId: table.buttonPlayerId,
    handNumber: table.handNumber,
    version: table.version,
    hand: table.hand ? getPublicHandView(table.hand, viewerId) : null,
  };
}
