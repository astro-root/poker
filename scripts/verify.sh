#!/usr/bin/env bash
# 検証実行: package.json に定義された検証を順に実行します。
#   bash scripts/verify.sh            # 型チェック + ユニット/統合テスト + ビルド
#   RUN_E2E=1 bash scripts/verify.sh  # さらに Playwright E2E（初回は Chromium を取得）
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_repo_root
[ -d node_modules ] || fail "node_modules がありません。先に npm ci を実行してください。"

say "npm run typecheck"; npm run typecheck
say "npm test";          npm test
say "npm run build";     npm run build
if [ "${RUN_E2E:-0}" = "1" ]; then
  say "Playwright E2E"
  npx playwright install chromium
  npm run test:e2e
fi
ok "すべての検証が成功しました"
