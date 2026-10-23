#!/usr/bin/env bash
# Poker Colosseum 総合アップデート適用スクリプト
#   git pull → 作業ブランチ作成 → ZIP展開 → 検証 → コミット → push → PR
#
# 置き場所: リポジトリのルート（poker-main-updated.zip と同じ場所）
# 使い方:
#   bash apply-colosseum-update.sh --dry-run   # 何も変更せず、ZIPと現在の作業ツリーの差分だけ表示
#   bash apply-colosseum-update.sh             # 各段階で確認しながら実行
# 環境変数:
#   BASE=main                         ベースブランチ
#   BRANCH=feature/colosseum-update   作業ブランチ名
#   ZIP=poker-main-updated.zip        ZIP のパス
#   SKIP_CHECKS=1                     型チェック/テスト/ビルドを省略（非推奨）
#   RUN_E2E=1                         Playwright E2E も実行
#   ASSUME_YES=1                      確認プロンプトを省略
# 認証は既存の git / gh の設定を使います。トークンをこのファイルに書かないでください。
# 強制 push・git add -A・.env のコミットは行いません。
set -euo pipefail

BASE="${BASE:-main}"
BRANCH="${BRANCH:-feature/colosseum-update}"
ZIP="${ZIP:-poker-main-updated.zip}"
PATCH_FILE="poker-colosseum-changes.patch"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
# アップロードした2ファイルは配布物なので、コミット対象にしない
UPLOADED=("$ZIP" "$PATCH_FILE" "apply-colosseum-update.sh")
# 旧更新用ファイル（再実行すると古い内容で上書きする危険があるため削除する）
OBSOLETE=("apply-update.sh" "poker-colosseum-update.zip")
SECRET_RE='(^|/)\.env($|\.)|\.pem$|\.key$|service[_-]?role|(^|/)node_modules/|(^|/)dist/|(^|/)\.vercel/|test-results/|playwright-report/'

say()  { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
confirm() {
  [ "${ASSUME_YES:-0}" = "1" ] && return 0
  read -r -p "$1 [y/N] " a; [ "$a" = "y" ] || fail "中止しました（ここまでの変更は残っています。git status で確認してください）。"
}
is_uploaded() { local f; for f in "${UPLOADED[@]}"; do [ "$1" = "$f" ] && return 0; done; return 1; }

# ── 0. 前提確認 ─────────────────────────────────────────
say "0. 前提の確認"
TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "git リポジトリの中で実行してください。"
cd "$TOP"
grep -q '"name": "poker"' package.json 2>/dev/null || fail "poker リポジトリのルートではありません: $TOP"
for c in git unzip node npm; do command -v "$c" >/dev/null || fail "$c が見つかりません。"; done
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || fail "Node.js 22.12 以上が必要です（現在 $(node -v)）。"
[ -f "$ZIP" ] || fail "$ZIP が見つかりません（リポジトリのルートに置いてください）。"
git remote get-url origin >/dev/null 2>&1 || fail "リモート origin が設定されていません。"
ok "repo: $TOP / origin: $(git remote get-url origin)"
unzip -tq "$ZIP" >/dev/null || fail "$ZIP が壊れています。"

# ZIP に危険なパスや秘密情報が含まれていないか
if unzip -Z1 "$ZIP" | grep -E '(^/|\.\./)' ; then fail "ZIP に不正なパスが含まれています。"; fi
if unzip -Z1 "$ZIP" | grep -E "$SECRET_RE" | grep -v -E '\.env\.example$'; then fail "ZIP に秘密情報や生成物の疑いがあるファイルがあります。"; fi
ok "ZIP の内容を確認（不正パス・秘密情報なし）"

# ── 展開して差分を確認（dry-run でもここまでは実行） ─────────────
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
unzip -q "$ZIP" -d "$TMP"
SRC="$TMP/poker-main"
[ -d "$SRC" ] && [ -f "$SRC/package.json" ] || fail "ZIP の構成が想定と異なります（poker-main/ が見つかりません）。"

say "ZIP と現在の作業ツリーの差分"
NEW=0; CHG=0
while IFS= read -r -d '' f; do
  rel="${f#"$SRC"/}"
  if [ ! -e "$rel" ]; then NEW=$((NEW+1)); echo "  + $rel"
  elif ! cmp -s "$f" "$rel"; then CHG=$((CHG+1)); echo "  ~ $rel"; fi
done < <(find "$SRC" -type f -print0)
echo "  新規 $NEW / 変更 $CHG / 削除予定: ${OBSOLETE[*]}"
if [ "$DRY" = "1" ]; then echo; echo "(dry-run: git の状態もファイルも変更していません)"; exit 0; fi

# ── 1. 作業ツリーの確認と git pull ───────────────────────────
say "1. 作業ツリーの確認と $BASE の更新"
DIRTY="$(git status --porcelain --untracked-files=all | sed -E 's/^.. //' | while IFS= read -r p; do is_uploaded "$p" || echo "$p"; done)"
if [ -n "$DIRTY" ]; then echo "$DIRTY" | sed 's/^/  /'; fail "未コミットの変更があります。コミットまたは退避（git stash）してから再実行してください。上書きはしません。"; fi
git fetch origin
git switch "$BASE"
git pull --ff-only origin "$BASE"
ok "$BASE を最新にしました: $(git rev-parse --short HEAD)"

# ── 2. 作業ブランチ ────────────────────────────────────────
say "2. 作業ブランチ: $BRANCH"
git show-ref --verify --quiet "refs/heads/$BRANCH" && fail "ブランチ $BRANCH は既に存在します。BRANCH=別名 で再実行するか、先に削除してください。"
git switch -c "$BRANCH"

# ── 3. ZIP を展開（上書き） ─────────────────────────────────
say "3. ZIP の内容を反映（$CHG 件を上書き、$NEW 件を追加）"
confirm "ZIP の内容でファイルを上書きします。よろしいですか？"
cp -a "$SRC"/. "$TOP"/
for f in "${OBSOLETE[@]}"; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then git rm -q -f "$f"; ok "削除: $f"
  elif [ -e "$f" ]; then rm -f "$f"; ok "削除: $f"; fi
done

# ── 4. 依存関係と検証 ───────────────────────────────────────
if [ "${SKIP_CHECKS:-0}" != "1" ]; then
  say "4. 依存関係のインストールと検証"
  npm ci
  npm run typecheck
  npm test
  npm run build
  if [ "${RUN_E2E:-0}" = "1" ]; then npx playwright install chromium; npm run test:e2e; fi
  ok "検証に成功しました"
else
  echo "  (SKIP_CHECKS=1: 検証を省略しました)"
fi

# ── 5. コミット対象の確認 ───────────────────────────────────
say "5. コミット対象の確認"
mapfile -t FILES < <(git status --porcelain --untracked-files=all | sed -E 's/^.. //' | while IFS= read -r p; do is_uploaded "$p" || echo "$p"; done)
LEAK="$(printf '%s\n' "${FILES[@]}" | grep -E "$SECRET_RE" | grep -v -E '\.env\.example$' || true)"
[ -z "$LEAK" ] || { echo "$LEAK" | sed 's/^/  /'; fail "秘密情報や生成物の疑いがあるファイルが含まれています。コミットを中止しました。"; }
[ "${#FILES[@]}" -gt 0 ] || fail "コミットする変更がありません。"
printf '  %s\n' "${FILES[@]}"
git --no-pager diff --stat | tail -3 || true
confirm "上記 ${#FILES[@]} 件をコミットしますか？"
# 削除済みファイルも含め、一覧のファイルだけをステージする（git add -A は使わない）
git add -A -- "${FILES[@]}"
git commit -q -F - <<'MSG'
feat: Poker Colosseum 総合アップデート

- AI: オールインに直面したとき、未行動の相手を倒すべき相手として数えていた判断入力を修正
- ホスト設定（初期スタック/ハンド数/SB/BB/アンティ）、観戦、表示名変更、リマッチの冪等化
- レート制限を操作別バケットに変更（マイグレーション追加）
- 利用規約・プライバシーポリシー（草案）、フッター、用語集の拡充、ブランド表記の統一
- メンテナンス用スクリプトを scripts/ に追加。危険な旧 apply-update.sh と旧ZIPを削除

デプロイ順序: supabase/migrations/20261023000100_rate_limit_buckets.sql → rooms 関数 → Vercel
詳細: docs/UPDATE_NOTES.md
MSG
ok "コミットしました: $(git rev-parse --short HEAD)"

# ── 6. push と PR ──────────────────────────────────────────
say "6. push と Pull Request"
confirm "origin/$BRANCH に push しますか？（強制 push ではありません）"
git push -u origin "$BRANCH" || fail "push に失敗しました。認証（gh auth login / SSH 鍵）を確認してください。コミットはローカルに残っています。"
ok "push しました"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh pr create --base "$BASE" --head "$BRANCH" --title "Poker Colosseum 総合アップデート" --body-file docs/UPDATE_NOTES.md \
    && ok "PR を作成しました" || echo "  PR の作成に失敗しました。GitHub 上で手動作成してください。"
else
  REPO_URL="$(git remote get-url origin | sed -E 's#^git@github.com:#https://github.com/#; s#\.git$##')"
  echo "  gh が未設定のため、次の URL から PR を作成してください:"
  echo "  $REPO_URL/compare/$BASE...$BRANCH?expand=1"
fi

say "完了。マージ前に docs/UPDATE_NOTES.md の「未確認事項」と「デプロイ手順」を確認してください。"
git --no-pager log --oneline -3
