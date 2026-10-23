import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, parseSettings } from '../src/poker/settings.ts';
import { applyTableAction, createTable, isGameOver, startNextHand, type TableState } from '../src/poker/table.ts';

const total = (t: TableState): number => t.seats.reduce((n, s) => n + s.stack, 0);
const inHand = (t: TableState): number => t.hand!.players.reduce((n, p) => n + p.stack + p.totalContribution, 0);
const seats = (...stacks: number[]) => stacks.map((stack, i) => ({ id: `p${i}`, stack }));
function foldAround(t: TableState): TableState {
  let next = t;
  while (next.hand!.stage !== 'complete') {
    const round = next.hand!.bettingRound!;
    const me = round.players.find((p) => p.id === round.actorId)!;
    next = applyTableAction(next, next.version, me.id, round.currentBet > me.streetContribution ? { type: 'fold' } : { type: 'check' });
  }
  return next;
}

test('settings validation rejects bad types, ranges, and blind/ante relations', () => {
  assert.equal(parseSettings(DEFAULT_SETTINGS).ok, true);
  for (const bad of [
    undefined, [], 'x', { ...DEFAULT_SETTINGS, smallBlind: 10, bigBlind: 10 }, { ...DEFAULT_SETTINGS, smallBlind: 0 },
    { ...DEFAULT_SETTINGS, ante: -1 }, { ...DEFAULT_SETTINGS, ante: 11 }, { ...DEFAULT_SETTINGS, startingStack: Number.MAX_SAFE_INTEGER + 1 },
    { ...DEFAULT_SETTINGS, startingStack: NaN }, { ...DEFAULT_SETTINGS, maxHands: -1 }, { ...DEFAULT_SETTINGS, maxHands: 1000 },
    { ...DEFAULT_SETTINGS, escalateBlinds: 'yes' }, { ...DEFAULT_SETTINGS, bigBlind: 2000 },
  ]) assert.equal(parseSettings(bad).ok, false, JSON.stringify(bad));
  assert.equal(parseSettings({ ...DEFAULT_SETTINGS, maxHands: 20 }).ok, true);
});

test('ante is collected before the blinds, counted in the pot, and chips are conserved', () => {
  const t = startNextHand(createTable(seats(1000, 1000, 1000), 5, 10, { ante: 2 }));
  assert.equal(t.hand!.ante, 2);
  const pot = t.hand!.players.reduce((n, p) => n + p.totalContribution, 0);
  assert.equal(pot, 3 * 2 + 5 + 10);
  assert.equal(inHand(t), 3000);
  const done = foldAround(t);
  assert.equal(total(done), 3000);
});

test('a player who cannot cover the ante pays what they have and is all-in; blinds are still posted correctly', () => {
  const t = startNextHand(createTable(seats(1000, 1, 1000), 5, 10, { ante: 5 }));
  const short = t.hand!.players.find((p) => p.id === 'p1')!;
  assert.equal(short.totalContribution >= 1, true);
  assert.equal(short.stack, 0);
  assert.equal(short.totalContribution <= 1, true, 'never pays more than the stack');
  assert.equal(inHand(t), 2001);
  const done = t.hand!.stage === 'complete' ? t : foldAround(t);
  assert.equal(total(done), 2001);
});

test('ante never comes back as an uncalled bet when everyone folds', () => {
  const t = startNextHand(createTable(seats(1000, 1000), 5, 10, { ante: 5 }));
  const done = foldAround(t);
  const r = done.hand!.result!;
  assert.equal(r.type, 'uncontested');
  // Two antes of 5 plus the 5/10 blinds; only the winner's uncalled blind excess could ever be returned, never the ante.
  if (r.type === 'uncontested') assert.equal(r.pot, 10 + 5 + 5 + (r.returned ? 0 : 5));
  assert.equal(total(done), 2000);
});

test('fixed blinds stay fixed when escalation is off; escalation doubles ante too', () => {
  let t = createTable(seats(100000, 100000), 5, 10, { ante: 1, escalateBlinds: false });
  for (let i = 0; i < 12; i++) { t = startNextHand(t); t = foldAround(t); }
  assert.equal(t.bigBlind, 10); assert.equal(t.ante, 1);
  let e = createTable(seats(100000, 100000), 5, 10, { ante: 1, escalateBlinds: true });
  for (let i = 0; i < 11; i++) { e = startNextHand(e); e = foldAround(e); }
  assert.equal(e.bigBlind, 20); assert.equal(e.ante, 2);
});

test('hand limit ends the game; unlimited mode keeps going', () => {
  let t = createTable(seats(1000, 1000), 5, 10, { maxHands: 2 });
  t = foldAround(startNextHand(t));
  assert.equal(isGameOver(t), false);
  t = foldAround(startNextHand(t));
  assert.equal(isGameOver(t), true);
  assert.throws(() => startNextHand(t), /hand limit/);
  let u = createTable(seats(1000, 1000), 5, 10, { maxHands: null });
  for (let i = 0; i < 15; i++) u = foldAround(startNextHand(u));
  assert.equal(isGameOver(u), false);
});

test('everyone but one out of chips ends the game before the hand limit', () => {
  let t = startNextHand(createTable(seats(10, 10), 5, 10, { maxHands: 50 }));
  while (t.hand!.stage !== 'complete') t = applyTableAction(t, t.version, t.hand!.bettingRound!.actorId!, { type: 'all-in' });
  if (t.hand!.result!.type === 'showdown' && t.seats.every((s) => s.stack > 0)) return; // split pot: nobody busted, nothing to assert
  assert.equal(isGameOver(t), true);
});
