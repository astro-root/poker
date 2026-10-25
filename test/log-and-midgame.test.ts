import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTableAction, createTable, startNextHand, updateTableSettings, type TableState } from '../src/poker/table.ts';
import { getPublicHandView } from '../src/poker/hand.ts';
import { parseSettings, DEFAULT_SETTINGS } from '../src/poker/settings.ts';
import { AI_LEVEL_LABELS, AI_LEVELS } from '../src/poker/ai.ts';

const seats = (...stacks: number[]) => stacks.map((stack, i) => ({ id: `p${i}`, stack }));
const actor = (t: TableState): string => t.hand!.bettingRound!.actorId!;
const act = (t: TableState, a: Parameters<typeof applyTableAction>[3]): TableState => applyTableAction(t, t.version, actor(t), a);

test('the hand records every public action with the chips it moved', () => {
  let t = startNextHand(createTable(seats(1000, 1000, 1000), 5, 10));
  const first = actor(t);
  t = act(t, { type: 'raise', to: 40 });
  const second = actor(t);
  t = act(t, { type: 'call' });
  t = act(t, { type: 'fold' });
  const log = t.hand!.actionLog!;
  assert.deepEqual(log.map((r) => r.type), ['raise', 'call', 'fold']);
  assert.equal(log[0]!.playerId, first);
  assert.equal(log[0]!.total, 40);
  assert.equal(log[1]!.playerId, second);
  assert.equal(log[1]!.allIn, false);
  assert.equal(log.every((r) => r.stage === 'preflop'), true);
});

test('an all-in is logged as all-in with the full stack, and a short call is flagged all-in', () => {
  let t = startNextHand(createTable(seats(1000, 100), 5, 10));
  t = act(t, { type: 'all-in' });
  const shove = t.hand!.actionLog![0]!;
  assert.equal(shove.type, 'all-in');
  assert.equal(shove.allIn, true);
  assert.ok(shove.total >= 100);
});

test('the action log is public: it carries no cards and is part of the public view', () => {
  let t = startNextHand(createTable(seats(1000, 1000), 5, 10));
  t = act(t, { type: 'call' });
  const view = getPublicHandView(t.hand!, 'p0');
  assert.equal(view.actions.length, 1);
  assert.deepEqual(Object.keys(view.actions[0]!).sort(), ['allIn', 'amount', 'playerId', 'stage', 'total', 'type']);
});

test('mid-game settings never alter the current hand and apply exactly from the next one', () => {
  let t = startNextHand(createTable(seats(1000, 1000), 5, 10, { escalateBlinds: true }));
  const before = { sb: t.hand!.smallBlind, bb: t.hand!.bigBlind };
  t = updateTableSettings(t, { smallBlind: 25, bigBlind: 50, ante: 5, maxHands: 4, escalateBlinds: true });
  assert.equal(t.hand!.smallBlind, before.sb);
  assert.equal(t.hand!.bigBlind, before.bb);
  while (t.hand!.stage !== 'complete') t = act(t, actor(t) && t.hand!.bettingRound!.currentBet > t.hand!.bettingRound!.players.find((p) => p.id === actor(t))!.streetContribution ? { type: 'fold' } : { type: 'check' });
  t = startNextHand(t);
  assert.equal(t.hand!.smallBlind, 25, 'the new blinds are used exactly, not multiplied by an old escalation level');
  assert.equal(t.hand!.bigBlind, 50);
  assert.equal(t.hand!.ante, 5);
  assert.equal(t.maxHands, 4);
});

test('a hand limit below the hands already played is refused', () => {
  let t = startNextHand(createTable(seats(1000, 1000), 5, 10));
  assert.throws(() => updateTableSettings(t, { smallBlind: 5, bigBlind: 10, ante: 0, maxHands: 0, escalateBlinds: true }), /hand limit/i);
  t = updateTableSettings(t, { smallBlind: 5, bigBlind: 10, ante: 0, maxHands: t.handNumber, escalateBlinds: false });
  assert.equal(t.maxHands, t.handNumber);
});

test('showHandRank defaults to on, accepts a boolean, and rejects other types', () => {
  const { showHandRank: _omit, ...legacy } = DEFAULT_SETTINGS;
  const old = parseSettings(legacy);
  assert.equal(old.ok && old.settings.showHandRank, true);
  const off = parseSettings({ ...DEFAULT_SETTINGS, showHandRank: false });
  assert.equal(off.ok && off.settings.showHandRank, false);
  assert.equal(parseSettings({ ...DEFAULT_SETTINGS, showHandRank: 'no' }).ok, false);
});

test('AI levels have distinct, non-numeric display names and keep their internal ids', () => {
  const labels = AI_LEVELS.map((level) => AI_LEVEL_LABELS[level]);
  assert.equal(new Set(labels).size, 4);
  assert.deepEqual([...AI_LEVELS], ['weak', 'medium', 'strong', 'strongest']);
  for (const old of ['弱い', '中くらい', '強い', '最強']) assert.ok(!labels.includes(old));
});
