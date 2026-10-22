#!/usr/bin/env bash
# Poker Colosseum アップデート適用スクリプト
#   zip 展開 → 不要ファイル削除 → 依存インストール → テスト/型/ビルド → 3コミット → push
#
# 使い方（リポジトリのルートで実行。zip はルートに置くか、引数で指定）:
#   bash apply-update.sh                         # ./poker-colosseum-update.zip を使う
#   bash apply-update.sh /path/to/update.zip     # zip の場所を指定
# 環境変数:
#   BRANCH=feature/colosseum   指定すると、そのブランチを作って（または切り替えて）コミット/pushする
#   RUN_E2E=1                  Playwright e2e も実行する（初回は Chromium をインストール）
#   SKIP_CHECKS=1              テスト/型チェック/ビルドを省略する（非推奨）
#   FORCE=1                    未コミットの変更があっても続行する
set -euo pipefail

ZIP_NAME="poker-colosseum-update.zip"
say()  { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "git リポジトリの中で実行してください。"
cd "$REPO_ROOT"
grep -q '"name": "poker"' package.json 2>/dev/null || fail "ここは poker リポジトリのルートではないようです: $REPO_ROOT"

# ── zip を探す
ZIP="${1:-}"
if [ -z "$ZIP" ]; then
  for candidate in "$REPO_ROOT/$ZIP_NAME" "$PWD/$ZIP_NAME" "$HOME/$ZIP_NAME" "$HOME/Downloads/$ZIP_NAME" "/workspaces/$ZIP_NAME" "/tmp/$ZIP_NAME"; do
    if [ -f "$candidate" ]; then ZIP="$candidate"; break; fi
  done
fi
[ -n "$ZIP" ] && [ -f "$ZIP" ] || fail "$ZIP_NAME が見つかりません。リポジトリのルートに置くか、パスを引数で渡してください。"
ZIP="$(cd "$(dirname "$ZIP")" && pwd)/$(basename "$ZIP")"
say "zip: $ZIP"

# ── 作業ツリーの確認（zip / このスクリプト自体は無視）
DIRTY="$(git status --porcelain | grep -v -E '^\?\? (poker-colosseum-update\.zip|apply-update\.sh)$' || true)"
if [ -n "$DIRTY" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "$DIRTY"
  fail "未コミットの変更があります。先にコミット/退避するか、FORCE=1 で再実行してください。"
fi

if [ -n "${BRANCH:-}" ]; then
  say "ブランチ: $BRANCH"
  git checkout -B "$BRANCH"
fi
echo "現在のブランチ: $(git rev-parse --abbrev-ref HEAD)"

# ── 展開（既存ファイルは上書き）
say "zip を展開"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
unzip -q -o "$ZIP" -d "$TMP_DIR"
cp -a "$TMP_DIR"/. "$REPO_ROOT"/

# ── 削除するファイル / 追跡をやめるファイル
say "不要ファイルを整理"
rm -f src/poker/rooms.ts
for dir in docs/design/before docs/design/after; do
  if git ls-files --error-unmatch "$dir" >/dev/null 2>&1; then git rm -r -q --cached "$dir"; fi
done

# ── 依存関係とチェック
say "npm install（package-lock.json も更新されます）"
npm install --no-audit --no-fund

if [ "${SKIP_CHECKS:-0}" != "1" ]; then
  say "npm test";           npm test
  say "npm run typecheck";  npm run typecheck
  say "npm run build";      npm run build
fi
if [ "${RUN_E2E:-0}" = "1" ]; then
  say "Playwright e2e"
  npx playwright install --with-deps chromium
  npm run test:e2e
fi

# ── コミット（3つ）
EXCLUDES=(':!poker-colosseum-update.zip' ':!apply-update.sh')

say "コミット 1/3: ルール・AI・サーバーの修正"
git add -A -- src/poker src/supabase supabase test/*.test.ts test/helpers
git commit -q -m "fix: 不具合修正（A-2〜A-9）とAIの強さ4段階を追加

- A-2: 支払い不要の最後の1人に手番が残る問題を修正。無料フォールドを拒否
- A-3: pagehide では待機ロビーを離れるときだけ leave を送る
- A-4: 離席してもチップと席を保持し、復帰後の次ハンドから配札
- A-5: stateポーリングの在席書き込みを5秒に1回へ削減
- A-6: エラーに code を追加し、409でも本来の文言を表示
- A-7: 待機中ルームの不在者を60秒で整理し、ホストを移譲
- A-8: JWT の sub/role/exp を検証（verify_jwt=true が前提）
- A-9: 期限切れ処理の例外でルームが操作不能にならないようにした
- T4-2/T4-3: 表示名の正規化、未使用の rooms.ts を削除
- AI: 弱い/中くらい/強い/最強の4段階、1〜7人に対応
- テスト: ファジングを強化、サーバー修正の統合テストを追加" || echo "(コミット対象なし)"

say "コミット 2/3: Poker Colosseum デザイン刷新・画面構成の分割"
git add -A -- src/app src/views src/ui src/main.ts src/style.css public index.html package.json package-lock.json tsconfig.json
git commit -q -m "feat: Poker Colosseum としてデザインを刷新

- ダーク基調・ゴールド1色のデザイントークン、ロゴ/ファビコン/OGP/manifest
- 手札と操作をスマホは画面下に固定、PCは右サイドパネル。席は楕円卓に配置
- AI対戦の設定画面（強さ4段階・人数1〜7人）
- main.ts を app/ と views/ に分割。開発専用のオンライン画面モックを追加
- Noto Sans JP をセルフホスト" || echo "(コミット対象なし)"

say "コミット 3/3: セキュリティヘッダ・e2e・ドキュメント"
git add -A -- . "${EXCLUDES[@]}"
git commit -q -m "chore: vercelヘッダ、e2e(axe含む)、ドキュメント更新

- vercel.json にCSP等のセキュリティヘッダとSPA rewrite
- Playwright e2e（表示・横スクロール・手札の可視性・コントラスト）
- README / DECISIONS / ISSUES / SUPABASE_SETUP を更新
- docs/design の大きなPNGを追跡対象から外し、代表WebPのみ残す" || echo "(コミット対象なし)"

# ── push
say "push"
BRANCH_NOW="$(git rev-parse --abbrev-ref HEAD)"
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  git push
else
  git push -u origin "$BRANCH_NOW"
fi

say "完了 🎉"
git --no-pager log --oneline -3
cat <<'MSG'

次にやること:
  1) Supabase の Edge Function を再デプロイしてください（サーバー側を修正しています）:
       npx supabase functions deploy rooms
     ※ ここで ../../../src/poker/*.ts の import が解決できない場合は SUPABASE_SETUP.md の
       「デプロイ時の確認（V-02）」を参照してください。
  2) Vercel のデプロイ完了後、/ai と /online を実機（スマホ）で確認してください。
MSG
