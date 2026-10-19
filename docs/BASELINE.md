# Baseline

実行日: 2026-10-19
Node.js: v24.21.0
npm: 11.19.0

| Command | Result |
| --- | --- |
| `npm ci` | 成功（27 packages） |
| `npm test` | 成功（29 tests） |
| `npm run typecheck` | 初回失敗。役一覧ページの `HAND_NAMES` 添字が配列の `keyof` で広く推論されていた。`HandCategory` で添字を絞る修正後に成功。 |
| `npm run build` | 成功（Vite 8.3.4） |
| `npm audit` | 成功、脆弱性 0 件。初回は sandbox 内の DNS 制限で失敗したため、ネットワーク許可後に再実行。 |

ベースライン時点の型検査失敗は、Phase 0 の検証を揃えるため `src/main.ts` で修正済み。
