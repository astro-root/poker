#!/usr/bin/env bash
# 更新パッケージ作成: Git が追跡している（または追跡予定の）ファイルだけを ZIP にします。
# .env・node_modules・dist・秘密情報は含めません。--dry-run で対象一覧だけを表示します。
#   bash scripts/make-package.sh [--dry-run] [出力ZIPのパス]
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_repo_root
DRY=0; OUT=""
for arg in "$@"; do case "$arg" in --dry-run) DRY=1 ;; *) OUT="$arg" ;; esac; done
OUT="${OUT:-dist-package/poker-update-$(date +%Y%m%d-%H%M%S).zip}"

# 追跡済み + 未追跡（.gitignore 対象外）のファイル。
LIST="$(git ls-files --cached --others --exclude-standard | grep -v -E "$SECRET_PATTERN" | grep -v -E '\.zip$' || true)"
[ -n "$LIST" ] || fail "対象ファイルがありません。"
echo "$LIST" | sed 's/^/  /'
echo "  合計 $(echo "$LIST" | wc -l | tr -d ' ') ファイル → $OUT"
[ "$DRY" = "1" ] && { echo "(dry-run: ZIP は作成していません)"; exit 0; }

mkdir -p "$(dirname "$OUT")"
[ ! -e "$OUT" ] || fail "出力先が既に存在します: $OUT"
echo "$LIST" | zip -q "$OUT" -@
ok "作成しました: $OUT"
echo "  ※ このZIPは単なる配布用です。展開先を上書きする自動スクリプトは提供していません。"
