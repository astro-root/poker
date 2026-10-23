import { applyTableAction, createTable, startNextHand, type TableState } from '../poker/table.ts';
import { getLegalActions } from '../poker/betting.ts';
import type { OnlineRoom, RoomPeer } from '../supabase/online-room.ts';
import { applyOnlineRoom } from './online.ts';
import { DEFAULT_SETTINGS } from '../poker/settings.ts';
import { store } from './state.ts';

/**
 * Development-only fixtures (`?mock=lobby|playing|finished`) so online screens can be reviewed and tested
 * without Supabase. main.ts imports this behind `import.meta.env.DEV`, so production bundles never contain it.
 */
function peers(me: string): RoomPeer[] {
  return [
    { id: me, name: store.playerName, connected: true },
    { id: 'mock-yuki', name: 'ユウキ', connected: true },
    { id: 'mock-sora', name: 'ソラ', connected: false },
  ];
}

function playUntilHumanTurn(table: TableState, me: string): TableState {
  let next = table;
  for (let guard = 0; guard < 20 && next.hand?.bettingRound && next.hand.bettingRound.actorId !== me; guard++) {
    const actor = next.hand.bettingRound.actorId!;
    const legal = getLegalActions(next.hand.bettingRound, actor);
    next = applyTableAction(next, next.version, actor, legal.canCheck ? { type: 'check' } : { type: 'call' });
  }
  return next;
}

export function applyMockOnline(kind: string): 'lobby' | 'room' | null {
  const me = store.humanId;
  const base = { roomId: 'a'.repeat(36), hostId: me, revision: 1, version: 0, notice: '', role: 'player' as const, spectators: [], settings: DEFAULT_SETTINGS, settingsVersion: 0 };
  if (kind === 'lobby') return 'lobby';
  if (kind === 'lobby-joined') {
    applyOnlineRoom({ ...base, status: 'waiting', winnerId: null, peers: peers(me), table: null, notice: '招待リンクを共有して友だちを待っています。' });
    return 'room';
  }
  if (kind === 'playing') {
    const table = playUntilHumanTurn(startNextHand(createTable([{ id: me, stack: 1_000 }, { id: 'mock-yuki', stack: 1_000 }, { id: 'mock-sora', stack: 1_000 }], 5, 10)), me);
    applyOnlineRoom({ ...base, status: 'playing', winnerId: null, peers: peers(me), table, version: table.version, notice: 'ユウキがアクションしました。' } satisfies OnlineRoom);
    return 'room';
  }
  if (kind === 'finished') {
    let table = startNextHand(createTable([{ id: me, stack: 10 }, { id: 'mock-yuki', stack: 10 }], 5, 10));
    while (table.hand?.stage !== 'complete') {
      const actor = table.hand!.bettingRound!.actorId!;
      const legal = getLegalActions(table.hand!.bettingRound!, actor);
      table = applyTableAction(table, table.version, actor, legal.canRaise || table.hand!.players.find((p) => p.id === actor)!.stack <= legal.callAmount ? { type: 'all-in' } : { type: legal.canCheck ? 'check' : 'call' });
    }
    const winner = table.seats.find((seat) => seat.stack > 0)?.id ?? me;
    applyOnlineRoom({ ...base, status: 'finished', winnerId: winner, peers: peers(me).slice(0, 2), table, version: table.version, notice: '対戦が終了しました。' });
    return 'room';
  }
  return null;
}
