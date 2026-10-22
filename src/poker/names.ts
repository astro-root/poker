/** Display-name rules shared by the browser and the Edge Function (T4-2). */

export const MAX_NAME_LENGTH = 20;
// Control characters, and format characters such as bidi overrides, zero-width spaces and joiners.
const FORBIDDEN = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const FORBIDDEN_GLOBAL = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

export function hasForbiddenNameCharacter(value: string): boolean {
  return FORBIDDEN.test(value);
}

/** Length in Unicode code points, not UTF-16 units, so emoji and rare kanji are not split. */
export function nameLength(value: string): number {
  return Array.from(value).length;
}

/** Lenient clean-up for text typed in the browser: strips forbidden characters and trims to 20 code points. */
export function cleanNameInput(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const collapsed = value.normalize('NFC').replace(FORBIDDEN_GLOBAL, '').replace(/\s+/gu, ' ').trim();
  return Array.from(collapsed).slice(0, MAX_NAME_LENGTH).join('') || fallback;
}

export type NameCheck = Readonly<{ ok: true; name: string } | { ok: false; reason: 'type' | 'forbidden' | 'too-long' }>;

/** Strict check for the server: reject rather than silently rewriting hostile input. */
export function validateDisplayName(value: unknown, fallback: string): NameCheck {
  if (value === undefined || value === null) return { ok: true, name: fallback };
  if (typeof value !== 'string') return { ok: false, reason: 'type' };
  if (hasForbiddenNameCharacter(value)) return { ok: false, reason: 'forbidden' };
  const collapsed = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (nameLength(collapsed) > MAX_NAME_LENGTH) return { ok: false, reason: 'too-long' };
  return { ok: true, name: collapsed || fallback };
}

/** Appends " 2", " 3"… so two people at one table never share a label. */
export function uniqueDisplayName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((entry) => entry.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let suffix = 2; suffix < 100; suffix++) {
    const tail = ` ${suffix}`;
    const candidate = `${Array.from(name).slice(0, MAX_NAME_LENGTH - tail.length).join('')}${tail}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}
