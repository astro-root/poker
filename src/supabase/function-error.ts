const fallbackMessage = 'ルームサーバーに接続できませんでした。';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

export async function getFunctionErrorMessage(error: unknown): Promise<string> {
  const details = record(error);
  const context = details?.context;
  if (typeof Response !== 'undefined' && context instanceof Response) {
    try {
      const payload = record(await context.clone().json());
      if (context.status === 409) return '状態が更新されました。最新の状態を読み込みます。';
      if (typeof payload?.error === 'string' && payload.error.length > 0) return payload.error;
    } catch {
      // Fall back to the SDK error when the response is not JSON.
    }
  }
  return error instanceof Error && error.message ? error.message : fallbackMessage;
}
