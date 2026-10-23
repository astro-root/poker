#!/usr/bin/env bash
# GitHub への反映支援: 専用ブランチを作成し、対象を確認してからコミットし、push します。
#   bash scripts/publish-branch.sh                 # dry-run（何も変更せず、対象だけ表示）
#   bash scripts/publish-branch.sh --execute       # 確認プロンプト付きで実行
#   BRANCH=feature/colosseum-update MESSAGE="..." bash scripts/publish-branch.sh --execute
# 認証は既存の git 設定（SSH 鍵 / credential helper / gh auth）を使います。トークンをこのスクリプトに書かないでください。
# 強制 push は行いません。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_repo_root
EXECUTE=0; [ "${1:-}" = "--execute" ] && EXECUTE=1
BRANCH="${BRANCH:-feature/colosseum-update}"
MESSAGE="${MESSAGE:-feat: Poker Colosseum 総合アップデート}"

CURRENT="$(git symbolic-ref --short HEAD 2>/dev/null || echo "(detached)")"
case "$CURRENT" in main|master) echo "現在 $CURRENT です。専用ブランチ $BRANCH を使用します。" ;; esac

# 対象: 変更・新規ファイルのうち、秘密情報パターンに当たらないもの
mapfile -t FILES < <(git status --porcelain --untracked-files=all | sed -E 's/^.. //' | grep -v -E "$SECRET_PATTERN" || true)
LEAKS="$(git status --porcelain --untracked-files=all | sed -E 's/^.. //' | grep -E "$SECRET_PATTERN" | grep -v -E '\.env\.example$' || true)"
[ -z "$LEAKS" ] || { echo "$LEAKS" | sed 's/^/  除外: /'; echo "  (上記は .gitignore で除外されるべきファイルです。コミット対象にしません)"; }
[ "${#FILES[@]}" -gt 0 ] || fail "コミットする変更がありません。"

say "コミット対象（${#FILES[@]} 件）"
printf '  %s\n' "${FILES[@]}"
say "ブランチ: $BRANCH / メッセージ: $MESSAGE"
if [ "$EXECUTE" != "1" ]; then echo "(dry-run: 何も変更していません。--execute で実行)"; exit 0; fi

read -r -p "このファイル一覧をコミットして push しますか？ [y/N] " ANSWER
[ "$ANSWER" = "y" ] || fail "中止しました。"

git checkout -B "$BRANCH"          # 既存の未コミット変更は作業ツリーにそのまま引き継がれます
git add -- "${FILES[@]}"            # 一覧に表示したファイルだけをステージ（git add -A は使いません）
git commit -m "$MESSAGE"
if git push -u origin "$BRANCH"; then ok "push しました: origin/$BRANCH"
else fail "push に失敗しました。認証（gh auth login / SSH 鍵）とリモートの差分を確認してください。強制 push はしていません。"; fi
