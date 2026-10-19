import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export type GuestSession = Readonly<{ guestId: string; tokenHash: string }>;
export type GuestCredential = Readonly<{ guestId: string; sessionToken: string; displayName: string }>;
export type RoomVisibility = 'private' | 'public';
export type RoomStatus = 'waiting' | 'playing' | 'closed';
export type RoomRole = 'player' | 'spectator';

export type RoomMember = Readonly<{
  guestId: string;
  displayName: string;
  role: RoomRole;
  seat: number | null;
  stack: number;
  connected: boolean;
}>;

export type PokerRoom = Readonly<{
  id: string;
  visibility: RoomVisibility;
  status: RoomStatus;
  hostGuestId: string;
  maxPlayers: number;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  version: number;
  members: readonly RoomMember[];
}>;

export type RoomSummary = Readonly<{
  id: string;
  status: RoomStatus;
  playerCount: number;
  spectatorCount: number;
  availableSeats: number;
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
}>;

export function normalizeDisplayName(input: string): string {
  const displayName = input.trim();
  const length = [...displayName].length;
  if (length < 1 || length > 24 || /[\u0000-\u001f\u007f]/u.test(displayName)) {
    throw new RangeError('Display names must contain 1 to 24 printable characters');
  }
  return displayName;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createGuestCredential(displayNameInput: string): Readonly<{ credential: GuestCredential; session: GuestSession }> {
  const displayName = normalizeDisplayName(displayNameInput);
  const sessionToken = randomBytes(32).toString('base64url');
  const guestId = randomUUID();
  return {
    credential: { guestId, sessionToken, displayName },
    session: { guestId, tokenHash: hashToken(sessionToken) },
  };
}

/** Stores only the SHA-256 verifier; compare fixed-length digests in constant time. */
export function verifyGuestSession(session: GuestSession, token: string): boolean {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) return false;
  const expected = Buffer.from(session.tokenHash, 'hex');
  const actual = Buffer.from(hashToken(token), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function validateRoomSettings(settings: {
  visibility: RoomVisibility;
  maxPlayers: number;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
}): void {
  if (!['private', 'public'].includes(settings.visibility)) throw new Error('Invalid room visibility');
  if (!Number.isInteger(settings.maxPlayers) || settings.maxPlayers < 2 || settings.maxPlayers > 10) {
    throw new RangeError('Room capacity must be between two and ten players');
  }
  if (!Number.isSafeInteger(settings.startingStack) || settings.startingStack < 1) throw new RangeError('Starting stack must be positive');
  if (!Number.isSafeInteger(settings.smallBlind) || !Number.isSafeInteger(settings.bigBlind)
    || settings.smallBlind < 1 || settings.bigBlind < settings.smallBlind) {
    throw new RangeError('Blinds must be positive and the big blind cannot be smaller than the small blind');
  }
}

function createRoomId(): string {
  return randomBytes(18).toString('base64url');
}

export function createRoom(
  host: Pick<GuestCredential, 'guestId' | 'displayName'>,
  settings: { visibility: RoomVisibility; maxPlayers: number; startingStack: number; smallBlind: number; bigBlind: number },
): Readonly<{ room: PokerRoom; invitationPath: string }> {
  validateRoomSettings(settings);
  if (!host.guestId) throw new Error('Host guest ID is required');
  const roomId = createRoomId();
  const room: PokerRoom = {
    id: roomId,
    visibility: settings.visibility,
    status: 'waiting',
    hostGuestId: host.guestId,
    maxPlayers: settings.maxPlayers,
    startingStack: settings.startingStack,
    smallBlind: settings.smallBlind,
    bigBlind: settings.bigBlind,
    version: 1,
    members: [{
      guestId: host.guestId,
      displayName: normalizeDisplayName(host.displayName),
      role: 'player',
      seat: 0,
      stack: settings.startingStack,
      connected: true,
    }],
  };
  // Credentials never belong in the invite URL; it contains only this opaque room ID.
  return { room, invitationPath: `/rooms/${roomId}` };
}

function nextSeat(members: readonly RoomMember[]): number {
  const occupied = new Set(members.filter((member) => member.role === 'player').map((member) => member.seat));
  for (let seat = 0; seat < 10; seat++) if (!occupied.has(seat)) return seat;
  return -1;
}

export function joinRoom(
  room: PokerRoom,
  guest: Pick<GuestCredential, 'guestId' | 'displayName'>,
  requestedRole: RoomRole = 'player',
): Readonly<{ room: PokerRoom; joinedAs: RoomRole }> {
  if (room.status === 'closed') throw new Error('Room is closed');
  if (!guest.guestId) throw new Error('Guest ID is required');
  if (requestedRole !== 'player' && requestedRole !== 'spectator') throw new Error('Invalid room role');
  const displayName = normalizeDisplayName(guest.displayName);
  const existing = room.members.find((member) => member.guestId === guest.guestId);
  if (existing) {
    const members = room.members.map((member) => member.guestId === guest.guestId
      ? { ...member, displayName, connected: true }
      : member);
    return { room: { ...room, members, version: room.version + 1 }, joinedAs: existing.role };
  }

  const players = room.members.filter((member) => member.role === 'player');
  // Late arrivals during a hand observe as spectators until the next hand boundary.
  const joinedAs: RoomRole = room.status === 'playing' ? 'spectator' : requestedRole;
  if (joinedAs === 'player' && players.length >= room.maxPlayers) throw new Error('Room is full');
  const seat = joinedAs === 'player' ? nextSeat(room.members) : -1;
  if (joinedAs === 'player' && seat < 0) throw new Error('No player seat is available');
  const member: RoomMember = {
    guestId: guest.guestId,
    displayName,
    role: joinedAs,
    seat: joinedAs === 'player' ? seat : null,
    stack: joinedAs === 'player' ? room.startingStack : 0,
    connected: true,
  };
  return { room: { ...room, members: [...room.members, member], version: room.version + 1 }, joinedAs };
}

export function startRoomGame(room: PokerRoom, actorGuestId: string, expectedVersion: number): PokerRoom {
  if (expectedVersion !== room.version) throw new Error('Stale room version; fetch the latest room state');
  if (actorGuestId !== room.hostGuestId) throw new Error('Only the room host can start the game');
  if (room.status !== 'waiting') throw new Error('Room is not waiting for a game');
  if (room.members.filter((member) => member.role === 'player' && member.connected).length < 2) {
    throw new Error('At least two connected players are required to start');
  }
  return { ...room, status: 'playing', version: room.version + 1 };
}

function chooseNewHost(members: readonly RoomMember[]): string | null {
  return [...members]
    .filter((member) => member.connected && member.role === 'player')
    .sort((a, b) => a.seat! - b.seat!)[0]?.guestId
    ?? members.find((member) => member.connected)?.guestId
    ?? null;
}

export function leaveRoom(room: PokerRoom, guestId: string): PokerRoom {
  const member = room.members.find((candidate) => candidate.guestId === guestId);
  if (!member) return room;
  let members: RoomMember[];
  if (room.status === 'playing' && member.role === 'player') {
    // Preserve the seat and chips until the current hand resolves; reconnect can restore presence.
    members = room.members.map((candidate) => candidate.guestId === guestId ? { ...candidate, connected: false } : candidate);
  } else {
    members = room.members.filter((candidate) => candidate.guestId !== guestId);
  }
  const hostGuestId = room.hostGuestId === guestId ? chooseNewHost(members) : room.hostGuestId;
  const status = members.length === 0 || hostGuestId === null ? 'closed' : room.status;
  return { ...room, members, hostGuestId: hostGuestId ?? guestId, status, version: room.version + 1 };
}

export function finishRoomGame(room: PokerRoom, expectedVersion: number): PokerRoom {
  if (expectedVersion !== room.version) throw new Error('Stale room version; fetch the latest room state');
  if (room.status !== 'playing') throw new Error('No game is in progress');
  const members = room.members.filter((member) => member.role === 'player' && member.connected);
  const players = members.filter((member) => member.stack > 0).length;
  if (players < 2) throw new Error('At least two players with chips are required for another hand');
  return { ...room, status: 'waiting', version: room.version + 1 };
}

export function listPublicRooms(rooms: readonly PokerRoom[]): RoomSummary[] {
  return rooms
    .filter((room) => room.visibility === 'public' && room.status !== 'closed')
    .map((room) => {
      const players = room.members.filter((member) => member.role === 'player');
      return {
        id: room.id,
        status: room.status,
        playerCount: players.length,
        spectatorCount: room.members.filter((member) => member.role === 'spectator').length,
        availableSeats: room.status === 'waiting' ? Math.max(0, room.maxPlayers - players.length) : 0,
        maxPlayers: room.maxPlayers,
        smallBlind: room.smallBlind,
        bigBlind: room.bigBlind,
      };
    });
}
