const fallbackMessage = 'ルームサーバーに接続できませんでした。';
const staleMessage = '状態が更新されました。最新の状態を読み込みます。';
const REFRESH_CODES = new Set(['STALE_VERSION', 'REVISION_CONFLICT']);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

/** Codes that mean "your screen is behind" and are handled by silently refetching. */
export function isRefreshCode(code: unknown): boolean {
  return typeof code === 'string' && REFRESH_CODES.has(code);
}

export async function getFunctionErrorMessage(error: unknown): Promise<string> {
  const details = record(error);
  const context = details?.context;
  if (typeof Response !== 'undefined' && context instanceof Response) {
    try {
      const payload = record(await context.clone().json());
      // Only version/revision conflicts get the generic refresh text; other 409s (full room, started game…) keep the server wording.
      if (isRefreshCode(payload?.code)) return staleMessage;
      if (typeof payload?.error === 'string' && payload.error.length > 0) return payload.error;
    } catch {
      // Fall back to the SDK error when the response is not JSON.
    }
  }
  return error instanceof Error && error.message ? error.message : fallbackMessage;
}
