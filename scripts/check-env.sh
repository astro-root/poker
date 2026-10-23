#!/usr/bin/env bash
# 環境確認: 必要なコマンドとバージョンを表示します（何も変更しません）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_repo_root

need() { command -v "$1" >/dev/null 2>&1 && ok "$1: $("$1" --version 2>&1 | head -1)" || fail "$1 が見つかりません。"; }
say "必須コマンド"
need git; need node; need npm

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js 22.12 以上が必要です（現在 $(node -v)）。package.json の engines を参照。"

say "任意コマンド"
for cmd in supabase vercel gh; do
  if command -v "$cmd" >/dev/null 2>&1; then ok "$cmd: $("$cmd" --version 2>&1 | head -1)"; else echo "  - $cmd: 未インストール（必要な作業のときだけ導入）"; fi
done

say "依存関係"
[ -d node_modules ] && ok "node_modules あり" || echo "  - node_modules なし: npm ci を実行してください"

say "環境変数ファイル"
if [ -f .env ]; then ok ".env あり（内容は表示しません）"; else echo "  - .env なし: .env.example をコピーして設定してください"; fi
