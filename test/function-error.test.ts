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
  for (const code of ['STALE_VERSION', 'REVISION_CONFLICT']) {
    const conflict = Object.assign(new Error('generic'), { context: Response.json({ error: 'old version', code }, { status: 409 }) });
    assert.equal(await getFunctionErrorMessage(conflict), '状態が更新されました。最新の状態を読み込みます。');
  }
  assert.equal(await getFunctionErrorMessage(new Error('network unavailable')), 'network unavailable');
  assert.equal(await getFunctionErrorMessage({}), 'ルームサーバーに接続できませんでした。');
});

test('A-6: other 409 responses keep the server wording instead of the refresh text', async () => {
  for (const [code, message] of [['ROOM_FULL', 'このルームは満員です（最大6人）。'], ['GAME_STARTED', 'この対戦はすでに始まっています。'], ['NOT_ENOUGH_PLAYERS', '在席中のプレイヤーが2人以上必要です。']]) {
    const error = Object.assign(new Error('generic'), { context: Response.json({ ok: false, error: message, code }, { status: 409 }) });
    assert.equal(await getFunctionErrorMessage(error), message);
  }
});
