#!/usr/bin/env bash
# 反映確認: 今回の修正が (1) ソースに入っているか (2) 本番に出ているか を調べます（読み取り専用）。
#   bash scripts/verify-update.sh                              # ソースだけ確認
#   bash scripts/verify-update.sh https://poker.astro-root.com # 本番のJSも確認
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_repo_root
MISS=0
chk() { # 説明 パターン ファイル
  if grep -qE -- "$2" "$3" 2>/dev/null; then ok "$1"; else printf '  \033[1;31m✖\033[0m %s  (%s に見つかりません)\n' "$1" "$3"; MISS=$((MISS+1)); fi
}
chk_absent() { if grep -qE -- "$2" "$3" 2>/dev/null; then printf '  \033[1;31m✖\033[0m %s  (%s にまだ残っています)\n' "$1" "$3"; MISS=$((MISS+1)); else ok "$1"; fi; }

say "ソースの確認（git: $(git rev-parse --abbrev-ref HEAD 2>/dev/null) @ $(git rev-parse --short HEAD 2>/dev/null)）"
chk "AIレベル名 (新兵/剣闘士/百人隊長/皇帝)" "新兵.*剣闘士.*百人隊長.*皇帝" src/poker/ai.ts
chk "設定ダイアログ" "showModal" src/ui/settings-dialog.ts
chk "強制退出 (サーバー)" "action === 'kick'" supabase/functions/rooms/index.ts
chk "チャット (サーバー)" "action === 'chat'" supabase/functions/rooms/index.ts
chk "ルームコード (サーバー)" "newRoomCode" supabase/functions/rooms/index.ts
chk "ルームコード (マイグレーション)" "poker_rooms_code_key" supabase/migrations/20261023000200_room_code.sql
chk "招待リンクは即参加しない" "online.invite = inviteId" src/main.ts
chk "ハンバーガー" "nav-toggle" src/ui/header.ts
chk "オールイン確認" "renderAllInConfirm" src/views/table-view.ts
chk "役の表示設定" "rankVisible" src/views/table-view.ts
chk "アクション履歴" "action-log" src/views/table-view.ts
chk "ルールページ" "renderRulesPage" src/main.ts
chk "運営者名 Root" "Root（astro-root）" src/ui/legal.ts
chk "問い合わせ先" "astro-root.com/contact" src/ui/legal.ts
chk "スクロール保持" "keepingScroll" src/main.ts
chk_absent "手札の傾き(rotate)の削除" "hero-cards .playing-card:first-child \{ transform: rotate" src/style.css

if [ "${1:-}" != "" ]; then
  BASE="${1%/}"
  say "本番の確認: $BASE"
  HTML="$(curl -fsSL "$BASE/" 2>/dev/null)" || { echo "  取得できませんでした（URL・ネットワークを確認）"; exit 1; }
  JS="$(printf '%s' "$HTML" | grep -oE '/assets/[^"]+\.js' | head -3)"
  [ -n "$JS" ] || { echo "  JSが見つかりません"; exit 1; }
  ALL=""; for f in $JS; do ALL="$ALL$(curl -fsSL "$BASE$f" 2>/dev/null)"; done
  for word in 新兵 ルームコード 観戦する; do
    if printf '%s' "$ALL" | grep -q "$word"; then ok "本番のJSに「$word」あり"; else printf '  \033[1;31m✖\033[0m 本番のJSに「%s」がありません → 古い版が配信されています\n' "$word"; MISS=$((MISS+1)); fi
  done
fi
[ "$MISS" = "0" ] && ok "すべて確認できました" || { echo; echo "  $MISS 件が未反映です。上の ✖ を教えてください。"; exit 2; }
