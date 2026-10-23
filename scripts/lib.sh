#!/usr/bin/env bash
# Shared helpers for the maintenance scripts. Sourced, not executed.
say()  { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# Resolve the repo root and refuse to run anywhere else.
require_repo_root() {
  local top
  top="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "git リポジトリの中で実行してください。"
  cd "$top"
  grep -q '"name": "poker"' package.json 2>/dev/null || fail "poker リポジトリのルートではありません: $top"
}

# Paths that must never be committed or packaged.
SECRET_PATTERN='(^|/)\.env($|\.)|\.pem$|\.key$|service[_-]?role|(^|/)node_modules/|(^|/)dist/|(^|/)\.vercel/|test-results/|playwright-report/|(^|/)\.git/'
