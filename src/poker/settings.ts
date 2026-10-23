/** Host-configurable room settings, validated identically by the browser and the Edge Function. */

export type RoomSettings = Readonly<{
  /** Chips every player starts with. */
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  /** Paid by every player each hand before the blinds; 0 disables it. */
  ante: number;
  /** Hands to play before the game ends, or null for unlimited play. */
  maxHands: number | null;
  /** When true, blinds and ante double every 10 hands (the original behaviour). */
  escalateBlinds: boolean;
}>;

export const STACK_PRESETS = [500, 1_000, 2_000, 5_000, 10_000] as const;
export const HAND_PRESETS = [5, 10, 20, 50] as const;
export const SETTINGS_LIMITS = Object.freeze({
  minStack: 100, maxStack: 1_000_000, maxHands: 999,
});

export const DEFAULT_SETTINGS: RoomSettings = Object.freeze({
  startingStack: 1_000, smallBlind: 5, bigBlind: 10, ante: 0, maxHands: null, escalateBlinds: true,
});

export type SettingsCheck = Readonly<{ ok: true; settings: RoomSettings } | { ok: false; error: string }>;

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);

/**
 * Strict validation: wrong types are rejected rather than coerced, so a crafted request cannot smuggle
 * strings, floats, negatives or oversized numbers into the game engine.
 */
export function parseSettings(value: unknown): SettingsCheck {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: '設定の形式が正しくありません。' };
  const raw = value as Record<string, unknown>;
  const { startingStack, smallBlind, bigBlind, ante, maxHands, escalateBlinds } = raw;
  if (!isInt(startingStack) || startingStack < SETTINGS_LIMITS.minStack || startingStack > SETTINGS_LIMITS.maxStack) {
    return { ok: false, error: `初期スタックは${SETTINGS_LIMITS.minStack}〜${SETTINGS_LIMITS.maxStack.toLocaleString('ja-JP')}の整数で指定してください。` };
  }
  if (!isInt(smallBlind) || smallBlind < 1) return { ok: false, error: 'スモールブラインドは1以上の整数で指定してください。' };
  if (!isInt(bigBlind) || bigBlind <= smallBlind) return { ok: false, error: 'ビッグブラインドはスモールブラインドより大きくしてください。' };
  if (bigBlind > startingStack) return { ok: false, error: 'ビッグブラインドは初期スタック以下にしてください。' };
  if (!isInt(ante) || ante < 0) return { ok: false, error: 'アンティは0以上の整数で指定してください。' };
  if (ante > bigBlind) return { ok: false, error: 'アンティはビッグブラインド以下にしてください。' };
  if (maxHands !== null && (!isInt(maxHands) || maxHands < 1 || maxHands > SETTINGS_LIMITS.maxHands)) {
    return { ok: false, error: `ハンド数は1〜${SETTINGS_LIMITS.maxHands}、または無制限で指定してください。` };
  }
  if (typeof escalateBlinds !== 'boolean') return { ok: false, error: 'ブラインド上昇の指定が正しくありません。' };
  return { ok: true, settings: { startingStack, smallBlind, bigBlind, ante, maxHands: maxHands as number | null, escalateBlinds } };
}

/** Rooms created before settings existed fall back to the original defaults. */
export function settingsOrDefault(value: unknown): RoomSettings {
  const checked = parseSettings(value);
  return checked.ok ? checked.settings : DEFAULT_SETTINGS;
}
