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
#   BRANCH=feature/colosseum-update-2   作業ブランチ名
#   ZIP=poker-main-updated.zip        ZIP のパス
#   SKIP_CHECKS=1                     型チェック/テスト/ビルドを省略（非推奨）
#   RUN_E2E=1                         Playwright E2E も実行
#   ASSUME_YES=1                      確認プロンプトを省略
# 認証は既存の git / gh の設定を使います。トークンをこのファイルに書かないでください。
# 強制 push・git add -A・.env のコミットは行いません。
set -euo pipefail

BASE="${BASE:-main}"
BRANCH="${BRANCH:-feature/colosseum-update-2}"
ZIP="${ZIP:-poker-main-updated.zip}"
PATCH_FILE="poker-colosseum-changes-2.patch"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
ORIG_ZIP_NAME="$ZIP"

# このスクリプトと ZIP は、リポジトリ内にあると git pull / switch とぶつかる（追跡済みで、上書き保存されているため）。
# 先に一時フォルダへコピーし、そこから実行し直す。
if [ -z "${APPLY_REEXEC:-}" ]; then
  [ -f "$ZIP" ] || { printf '\n\033[1;31m✖ %s が見つかりません（リポジトリのルートで実行してください）。\033[0m\n' "$ZIP" >&2; exit 1; }
  WORK_COPY="$(mktemp -d)"
  cp -- "$0" "$WORK_COPY/self.sh"; cp -- "$ZIP" "$WORK_COPY/update.zip"
  export APPLY_REEXEC=1 ORIG_ZIP_NAME="$ZIP" ZIP="$WORK_COPY/update.zip"
  exec bash "$WORK_COPY/self.sh" "$@"
fi
# アップロードした2ファイルは配布物なので、コミット対象にしない
# 配布物のファイル名パターン。GitHub のWebからアップロードされて main に混入していることがある
CLUTTER_GLOBS=('poker-main-updated*.zip' 'poker-colosseum-changes*.patch' 'apply-colosseum-update*.sh' 'apply-update.sh' 'poker-colosseum-update.zip')
UPLOADED=("$ZIP" "$PATCH_FILE" "poker-colosseum-changes.patch" "apply-colosseum-update.sh")
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
# 変更のあるパスを NUL 区切りで出力する（スペースや日本語を含むファイル名でも壊れない）
changed_paths() {
  { git diff --cached --name-only -z; git diff --name-only -z; git ls-files --others --exclude-standard -z; } | sort -zu
}

# 名前だけで判定する配布物（追跡済みでも、上書き保存した新しいスクリプトなどは「未コミットの変更」として数えない）
is_dist_name() {
  local f; for f in "${UPLOADED[@]}"; do [ "$1" = "$f" ] && return 0; done
  case "$1" in poker-main-updated*.zip|poker-colosseum-changes*.patch|apply-colosseum-update*.sh) return 0 ;; esac
  return 1
}

# まだ git に追跡されていない配布物だけを「コミット対象外」とみなす（追跡済みのものの削除はコミットに含める）
is_uploaded() {
  git ls-files --error-unmatch -- "$1" >/dev/null 2>&1 && return 1
  local f; for f in "${UPLOADED[@]}"; do [ "$1" = "$f" ] && return 0; done
  case "$1" in poker-main-updated*.zip|poker-colosseum-changes*.patch|apply-colosseum-update*.sh) return 0 ;; esac
  return 1
}

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

# REF（例: origin/main）の内容と ZIP を比べる。ローカルの作業ツリーは古い/途中の状態のことがあるため基準にしない。
compare_with_ref() {
  local ref="$1" f rel; NEW=0; CHG=0
  while IFS= read -r -d '' f; do
    rel="${f#"$SRC"/}"
    if ! git cat-file -e "$ref:$rel" 2>/dev/null; then NEW=$((NEW+1)); echo "  + $rel"
    elif ! git show "$ref:$rel" 2>/dev/null | cmp -s - "$f"; then CHG=$((CHG+1)); echo "  ~ $rel"; fi
  done < <(find "$SRC" -type f -print0)
  echo "  新規 $NEW / 変更 $CHG / 削除予定: ${OBSOLETE[*]}"
}

say "リモートの状態を取得"
git fetch origin "$BASE" || fail "git fetch に失敗しました（ネットワーク・認証を確認）。"
BEHIND="$(git rev-list --count "HEAD..origin/$BASE" 2>/dev/null || echo '?')"
AHEAD="$(git rev-list --count "origin/$BASE..HEAD" 2>/dev/null || echo '?')"
echo "  ローカルの $(git rev-parse --abbrev-ref HEAD): origin/$BASE より $AHEAD コミット先行 / $BEHIND コミット遅れ"
[ "$BEHIND" = "0" ] || { echo "  origin/$BASE の新しいコミット:"; git --no-pager log --oneline "HEAD..origin/$BASE" | head -12 | sed 's/^/    /'; }

say "ZIP と origin/$BASE の差分（実行すると、ここに出るファイルが ZIP の内容になります）"
compare_with_ref "origin/$BASE"
if [ "$DRY" = "1" ]; then
  echo; echo "(dry-run: 作業ツリーもブランチも変更していません)"
  echo "  差分が「変更 0 / 新規 0」なら、ZIP の内容はすでに origin/$BASE に入っています。"
  exit 0
fi

# ── 1. 作業ツリーの確認と git pull ───────────────────────────
say "1. 作業ツリーの確認と $BASE の更新"
DIRTY=""
while IFS= read -r -d '' p; do is_dist_name "$p" || DIRTY+="$p"$'\n'; done < <(changed_paths)
if [ -n "$DIRTY" ]; then printf '%s' "$DIRTY" | sed 's/^/  /'; fail "未コミットの変更があります。コミットまたは退避（git stash）してから再実行してください。上書きはしません。"; fi
# 上書き保存した配布物（スクリプト・ZIP・パッチ）が git の追跡対象だと pull が止まるので、リポジトリ側の版に戻す。
# 一時フォルダにコピー済みなので、この実行には影響しない。
while IFS= read -r -d '' p; do
  if is_dist_name "$p"; then git checkout -- "$p" && ok "元に戻しました（配布物）: $p"; fi
done < <(git diff --name-only -z)
git switch "$BASE"
PRE_PULL="$(git rev-parse HEAD)"
git pull --ff-only origin "$BASE" || fail "git pull --ff-only に失敗しました。ローカルの $BASE が origin/$BASE と分岐している可能性があります。git log --oneline --graph で確認してください（強制はしません）。"
ok "$BASE を最新にしました: $(git rev-parse --short HEAD)"

# ── 2. 作業ブランチ ────────────────────────────────────────
say "2. 作業ブランチ: $BRANCH"
git show-ref --verify --quiet "refs/heads/$BRANCH" && fail "ブランチ $BRANCH は既に存在します。BRANCH=別名 で再実行するか、先に削除してください。"
git switch -c "$BRANCH"

# ── 3. ZIP を展開（上書き） ─────────────────────────────────
say "3. ZIP の内容を反映（pull 後の $BASE との差分を再計算）"
compare_with_ref HEAD
[ "$NEW" -gt 0 ] || [ "$CHG" -gt 0 ] || fail "ZIP の内容はすでに $BASE に入っています。反映するものがありません。"
confirm "ZIP の内容でファイルを上書きします。よろしいですか？"
# ZIP は全ファイルのスナップショットなので、そのまま上書きすると、リモートで後から入った変更を古い内容で消してしまう。
# pull で今回取り込まれたファイルは上書きせず、一覧を出して手動での統合に回す。
mapfile -d '' -t UPSTREAM < <(git diff --name-only -z "$PRE_PULL" HEAD)
is_upstream() { local u; for u in "${UPSTREAM[@]}"; do [ "$u" = "$1" ] && return 0; done; return 1; }
SKIPPED=()
while IFS= read -r -d '' f; do
  rel="${f#"$SRC"/}"
  if [ -e "$rel" ] && cmp -s "$f" "$rel"; then continue; fi
  if is_upstream "$rel" && git cat-file -e "HEAD:$rel" 2>/dev/null; then SKIPPED+=("$rel"); continue; fi
  mkdir -p "$(dirname "$rel")"; cp -p -- "$f" "$rel"
done < <(find "$SRC" -type f -print0)
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  printf '\n\033[1;33m⚠ リモートで更新されていたため、ZIP では上書きしなかったファイル（%s 件）:\033[0m\n' "${#SKIPPED[@]}"
  printf '    %s\n' "${SKIPPED[@]}"
  echo "  これらは origin/$BASE 側の内容のままです。ZIP の内容が必要なら、差分を見て手動で統合してください:"
  echo "    unzip -p $ORIG_ZIP_NAME poker-main/<ファイル> | diff - <ファイル>"
fi
for f in "${OBSOLETE[@]}"; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then git rm -q -f "$f"; ok "削除: $f"
  elif [ -e "$f" ]; then rm -f "$f"; ok "削除: $f"; fi
done
# main に混入している配布物（ZIP・パッチ・適用スクリプト）をリポジトリから外す。手元のファイルは残す。
mapfile -t TRACKED_CLUTTER < <(git ls-files -- "${CLUTTER_GLOBS[@]}")
for f in "${TRACKED_CLUTTER[@]}"; do git rm -q --cached -- "$f"; ok "リポジトリから除外: $f"; done

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
FILES=()
while IFS= read -r -d '' p; do is_uploaded "$p" || FILES+=("$p"); done < <(changed_paths)
LEAK="$(printf '%s\n' "${FILES[@]}" | grep -E "$SECRET_RE" | grep -v -E '\.env\.example$' || true)"
[ -z "$LEAK" ] || { echo "$LEAK" | sed 's/^/  /'; fail "秘密情報や生成物の疑いがあるファイルが含まれています。コミットを中止しました。"; }
[ "${#FILES[@]}" -gt 0 ] || fail "コミットする変更がありません。"
printf '  %s\n' "${FILES[@]}"
git --no-pager diff --stat | tail -3 || true
confirm "上記 ${#FILES[@]} 件をコミットしますか？"
# 削除済みファイルも含め、一覧のファイルだけをステージする（git add -A は使わない）
git add -A -- "${FILES[@]}"
git commit -q -F - <<'MSG'
feat: ルーム設定ダイアログ・強制退出・チャット・ルームコードほか（第2弾）

- AIレベル名を 新兵/剣闘士/百人隊長/皇帝 に変更
- 招待リンクでの即参加をやめ、確認してから参加。名前変更を参加前後で可能に
- ホスト: 設定ダイアログ（作成時・試合中）、強制退出、役の表示切替
- アクション履歴、チャット/スタンプ、ルームコード、オールイン確認
- ハンバーガーメニュー、フッター再構成、ルールページ、アニメーション、レスポンシブ強化
- 運営者情報（Root / astro-root.com/contact）を反映

デプロイ順序: migrations 20261023000100 → 20261023000200_room_code.sql → rooms 関数 → Vercel
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
