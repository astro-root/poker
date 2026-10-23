#!/usr/bin/env bash
# 差分確認: ブランチ、作業ツリー、リモートとの差分を表示します（読み取り専用）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_repo_root

say "ブランチ"
git --no-pager branch -vv --no-color | sed 's/^/  /'
say "作業ツリー"
git status --short | sed 's/^/  /' || true
say "変更の概要（未コミット）"
if git rev-parse --verify -q HEAD >/dev/null; then git --no-pager diff --stat HEAD | tail -25; else echo "  (まだコミットがありません)"; fi
say "リモートとの差分"
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  git fetch --quiet || echo "  (fetch に失敗しました。ネットワークや認証を確認してください)"
  echo "  ahead/behind: $(git rev-list --left-right --count 'HEAD...@{u}' | awk '{print $1" ahead / "$2" behind"}')"
else
  echo "  upstream が未設定です（まだ push されていないブランチ）。"
fi
say "秘密情報の混入チェック（追跡対象とステージ済みのみ）"
if { git ls-files; git diff --cached --name-only; } | grep -E "$SECRET_PATTERN" | grep -v -E '\.env\.example$' ; then
  fail "上のファイルは追跡されています。コミットしないでください。"
else ok "疑わしいファイルはありません"; fi
