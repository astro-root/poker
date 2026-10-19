import test from 'node:test';
import assert from 'node:assert/strict';
import { getFunctionErrorMessage } from '../src/supabase/function-error.ts';

test('extracts the Japanese message from a Supabase Functions HTTP error response', async () => {
  const response = Response.json({ ok: false, error: 'このルームは満員です。' }, { status: 400 });
  const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), { context: response });
  assert.equal(await getFunctionErrorMessage(error), 'このルームは満員です。');
  assert.equal(response.bodyUsed, false);
});

test('uses a refresh message for conflicts and falls back for non-HTTP errors', async () => {
  const conflict = Object.assign(new Error('generic'), { context: Response.json({ error: 'old version' }, { status: 409 }) });
  assert.equal(await getFunctionErrorMessage(conflict), '状態が更新されました。最新の状態を読み込みます。');
  assert.equal(await getFunctionErrorMessage(new Error('network unavailable')), 'network unavailable');
  assert.equal(await getFunctionErrorMessage({}), 'ルームサーバーに接続できませんでした。');
});
