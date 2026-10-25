import { applyTableAction, createTable, startNextHand } from '../poker/table.ts';
import { buildAiContext, chooseAiAction } from '../poker/ai.ts';
import type { BettingAction } from '../poker/betting.ts';
import { AI_ROSTER, START_STACK, actionNotice, hooks, isAiPlayer, playerLabel, stageLabel, store } from './state.ts';
import { submitOnlineAction } from './online.ts';

let aiTimer: number | undefined;

/** Begins a fresh AI table using the saved level and opponent count. */
export function startPractice(): void {
  store.mode = 'practice';
  store.practiceStarted = true;
  if (aiTimer) window.clearTimeout(aiTimer);
  store.aiThinking = false;
  const opponents = AI_ROSTER.slice(0, store.ai.count);
  let table = createTable([
    { id: store.humanId, stack: START_STACK },
    ...opponents.map((ai) => ({ id: ai.id, stack: START_STACK })),
  ], 5, 10);
  table = startNextHand(table);
  store.table = table;
  store.humanStackAtHandStart = START_STACK;
  store.archivedHand = null;
  store.handHistory = [];
  store.coachOpen = false;
  store.raiseOpen = false;
  store.notice = 'カードが配られました。あなたの番が来たら行動を選びます。';
  window.scrollTo(0, 0);
  hooks.render();
  runAiIfNeeded();
}

export function backToSetup(): void {
  if (aiTimer) window.clearTimeout(aiTimer);
  store.aiThinking = false;
  store.practiceStarted = false;
  store.table = null;
  hooks.render();
}

export function performAction(action: BettingAction): void {
  const table = store.table;
  if (!table?.hand || table.hand.stage === 'complete' || store.aiThinking) return;
  store.raiseOpen = false;
  store.allInArmed = false;
  if (store.mode === 'online-playing') { submitOnlineAction(action); return; }
  try {
    const stage = stageLabel(table.hand.stage);
    store.table = applyTableAction(table, table.version, store.humanId, action);
    store.notice = actionNotice(store.playerName, action);
    store.handHistory.push(`${stage} · ${store.notice}`);
    hooks.render();
    runAiIfNeeded();
  } catch (error) {
    store.notice = error instanceof Error ? error.message : '操作を反映できませんでした。';
    hooks.render();
  }
}

export function continueToNextHand(): void {
  const table = store.table;
  if (!table) return;
  const canContinue = (table.seats.find((seat) => seat.id === store.humanId)?.stack ?? 0) > 0
    && table.seats.filter((seat) => seat.stack > 0).length >= 2;
  if (!canContinue) { startPractice(); return; }
  try {
    store.humanStackAtHandStart = table.seats.find((seat) => seat.id === store.humanId)?.stack ?? 0;
    store.table = startNextHand(table);
    store.handHistory = [];
    store.archivedHand = null;
    store.raiseOpen = false;
    store.notice = '次のハンドが始まりました。';
    hooks.render();
    runAiIfNeeded();
  } catch { startPractice(); }
}

/** Lets the AI seat that is on turn think briefly, then act through the normal rules engine. */
export function runAiIfNeeded(): void {
  const hand = store.table?.hand;
  const round = hand?.bettingRound;
  if (!hand || !round?.actorId || !isAiPlayer(round.actorId) || hand.stage === 'complete' || store.aiThinking) return;
  const actorId = round.actorId;
  store.aiThinking = true;
  store.notice = `${playerLabel(actorId)}が考えています…`;
  hooks.render();
  // A short, slightly varied pause makes turns readable; strong levels also do real work inside the timeout.
  const delay = 500 + Math.floor(Math.random() * 450);
  aiTimer = window.setTimeout(() => {
    const table = store.table;
    if (!table?.hand?.bettingRound || table.hand.bettingRound.actorId !== actorId) { store.aiThinking = false; return; }
    try {
      const stage = stageLabel(table.hand.stage);
      const action = chooseAiAction(buildAiContext(table.hand, actorId, store.ai.level));
      store.table = applyTableAction(table, table.version, actorId, action);
      store.notice = actionNotice(playerLabel(actorId), action);
      store.handHistory.push(`${stage} · ${store.notice}`);
    } catch (error) {
      store.notice = error instanceof Error ? error.message : `${playerLabel(actorId)}の操作を反映できませんでした。`;
    }
    store.aiThinking = false;
    hooks.render();
    runAiIfNeeded();
  }, delay);
}
