#!/usr/bin/env bash
# 修正の適用 + 不要ファイルの削除（1本で完結。パッチは内蔵しています）
#   bash apply-fix-and-cleanup.sh            # dry-run: 何も変更せず、実行内容だけ表示
#   bash apply-fix-and-cleanup.sh --execute  # 新しいブランチを作り、適用・削除・確認・コミット・push・PR作成
#
# 内容:
#   1. ルームコード参加の修正（入力の正規化・参加後処理の統一）
#   2. 利用規約/プライバシーポリシーの「記入欄」の削除、目次の番号重複の修正
#   3. 不要ファイルの削除（下の DELETE_LIST）と、それらへの参照の整理
# 安全性: origin/main から新しいブランチを切ります。強制pushはしません。main には直接コミットしません。
set -euo pipefail

BRANCH="${BRANCH:-chore/fix-and-cleanup}"
BASE="${BASE:-main}"
EXECUTE=0; [ "${1:-}" = "--execute" ] && EXECUTE=1

# 削除するファイル（アプリのビルド・テスト・デプロイのどれからも使われないもの）
DELETE_LIST=(
  "CODEX_TASKS_2.md"                    # AIへの作業指示書
  "develop-prompt.md"                   # AIへの開発指示書
  "docs/BASELINE.md"                    # 古い測定ログ（2026-10-19）
  "docs/design/ISSUES.md"               # 旧デザイン調整のメモ
  "docs/design/screenshots/ai-setup-390x844.webp"
  "docs/design/screenshots/ai-table-1280x800-7ai.webp"
  "docs/design/screenshots/ai-table-390x844-raise.webp"
  "docs/design/screenshots/home-1280x800.webp"
  "docs/design/screenshots/online-playing-1280x800.webp"
  "scripts/capture-design-before.mjs"   # デザイン調整時の一回限りのスクリプト
)

say()  { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
confirm() { [ "${ASSUME_YES:-0}" = "1" ] && return 0; read -r -p "$1 [y/N] " a; [ "$a" = "y" ] || fail "中止しました。"; }

TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "git リポジトリの中で実行してください。"
cd "$TOP"
grep -q '"name": "poker"' package.json 2>/dev/null || fail "poker リポジトリのルートではありません: $TOP"

TMP="$(mktemp -d)"; trap 'git worktree remove --force "$TMP/wt" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
sed -n '/^: <<'"'"'PATCH_EOF'"'"'$/,/^PATCH_EOF$/p' "$0" | sed '1d;$d' > "$TMP/fix.patch"
[ -s "$TMP/fix.patch" ] || fail "内蔵パッチを取り出せませんでした。スクリプトが壊れています。"

say "origin/$BASE を取得"
git fetch origin "$BASE" || fail "git fetch に失敗しました（ネットワーク・認証を確認）。"

say "確認（origin/$BASE の内容に対して）"
git worktree add -q --detach "$TMP/wt" "origin/$BASE"
( cd "$TMP/wt"
  git apply --check -p1 "$TMP/fix.patch" || { echo "  パッチを適用できません。origin/$BASE が想定と違います。出力を共有してください。" >&2; exit 1; }
) || exit 1
ok "修正パッチは origin/$BASE に適用できます"
git --no-pager apply --stat -p1 "$TMP/fix.patch" | sed 's/^/  /'
echo; echo "  削除するファイル:"
EXISTING=()
for f in "${DELETE_LIST[@]}"; do
  if git cat-file -e "origin/$BASE:$f" 2>/dev/null; then EXISTING+=("$f"); echo "    - $f"; fi
done
[ "${#EXISTING[@]}" -gt 0 ] || echo "    (すでにありません)"

if [ "$EXECUTE" != "1" ]; then echo; echo "(dry-run: 何も変更していません。--execute で実行します)"; exit 0; fi

say "実行"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then git status --short --untracked-files=no | sed 's/^/  /'; fail "未コミットの変更があります。コミットか git stash をしてから再実行してください。"; fi
git show-ref --verify --quiet "refs/heads/$BRANCH" && fail "ブランチ $BRANCH は既に存在します。BRANCH=別名 で再実行してください。"
confirm "origin/$BASE から $BRANCH を作り、上記を適用します。よろしいですか？"
git switch -c "$BRANCH" "origin/$BASE"
git apply -p1 "$TMP/fix.patch"; ok "修正を適用"
for f in "${EXISTING[@]}"; do git rm -q -- "$f"; done; ok "不要ファイルを ${#EXISTING[@]} 件削除"
[ -d docs/design ] && rmdir docs/design/screenshots docs/design 2>/dev/null || true

if [ "${SKIP_CHECKS:-0}" != "1" ]; then
  say "検証"
  [ -d node_modules ] || npm ci
  npm run typecheck; npm test; npm run build
  ok "検証に成功しました"
fi

say "コミットと push"
git add -u                                   # 追跡済みファイルの変更と削除だけ（未追跡のファイルは触らない）
git --no-pager diff --cached --stat | tail -4
confirm "コミットして push しますか？（強制 push ではありません）"
git commit -q -m "fix: room code join, remove fill-in lines from legal pages, fix TOC numbering; chore: remove unused files"
git push -u origin "$BRANCH" || fail "push に失敗しました。認証を確認してください（コミットはローカルに残っています）。"
ok "push しました: origin/$BRANCH"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh pr create --base "$BASE" --head "$BRANCH" --title "fix: ルームコード参加・法務ページ整理・不要ファイル削除" --body "ルームコード参加の修正、法務ページの記入欄削除と目次の番号重複の修正、不要ファイルの削除。" && ok "PR を作成しました"
else
  echo "  次の URL から PR を作成してください:"
  echo "  $(git remote get-url origin | sed -E 's#^git@github.com:#https://github.com/#; s#\.git$##')/compare/$BASE...$BRANCH?expand=1"
fi
exit 0

: <<'PATCH_EOF'
diff -ruN a/.gitignore b/.gitignore
--- a/.gitignore	2026-10-25 14:31:37.340831615 +0000
+++ b/.gitignore	2026-10-25 14:31:37.348209168 +0000
@@ -6,9 +6,6 @@
 .env.*
 !.env.example
 npm-debug.log*
-# Design captures are large; only docs/design/screenshots/*.webp and ISSUES.md are committed.
-docs/design/before/
-docs/design/after/
 test-results/
 playwright-report/
 
diff -ruN a/README.md b/README.md
--- a/README.md	2026-10-25 14:31:37.340928576 +0000
+++ b/README.md	2026-10-25 14:31:37.348235688 +0000
@@ -41,7 +41,7 @@
 
 `npm run test:e2e` は開発サーバーを自動起動し、全ページの表示、横スクロールなし、手札の可視性（A-1）、AI卓での操作、`@axe-core/playwright` による `color-contrast` 検査を行います。オンライン画面は、開発サーバー限定のフィクスチャ `/online?mock=lobby|lobby-joined|playing|finished` で再現します（本番ビルドには含まれません）。
 
-代表的な画面は `docs/design/screenshots/` にあります。デザインの経緯と対応状況は [`docs/design/ISSUES.md`](docs/design/ISSUES.md)、設計判断は [`docs/DECISIONS.md`](docs/DECISIONS.md) を参照してください。
+設計判断は [`docs/DECISIONS.md`](docs/DECISIONS.md) を参照してください。
 
 ## 構成
 
diff -ruN a/docs/DECISIONS.md b/docs/DECISIONS.md
--- a/docs/DECISIONS.md	2026-10-25 14:31:37.341248386 +0000
+++ b/docs/DECISIONS.md	2026-10-25 14:31:37.348288219 +0000
@@ -1,6 +1,6 @@
 - 2026-10-19: Supabase Edge Function は Node の型検査対象に含め、使用中の `Deno.env` / `Deno.serve` だけを最小宣言する。現状のハンドラは Node 統合テストから直接実行でき、別の純粋関数層へ分ける必要がないため。
 - 2026-10-19: ルーム作成/参加/アクションの簡易レート制限は、Edge Function isolate 間で共有できるよう PostgreSQL の原子的な1秒窓カウンターで実装する（ユーザーごとに10回）。
-- 2026-10-22: サイト名を「Poker Colosseum」に変更。ブランドマークは「スペード＋コロッセオのアーチ」（`public/favicon.svg`）。デザインの方向性は利用者の指示（参考3サイト：ほぼ黒の背景・番号付き一覧・1色アクセント）に従った。CODEX_TASKS_2 B-6 の「勝手にテーマを変えない」は、この指示により解除された。
+- 2026-10-22: サイト名を「Poker Colosseum」に変更。ブランドマークは「スペード＋コロッセオのアーチ」（`public/favicon.svg`）。デザインの方向性は利用者の指示（参考3サイト：ほぼ黒の背景・番号付き一覧・1色アクセント）に従った。以前の「勝手にテーマを変えない」という方針は、この指示により解除された。
 - 2026-10-22: AIの強さを4段階（新兵／剣闘士／百人隊長／皇帝。旧称: 弱い／中くらい／強い／最強）にし、人数を1〜7人から選べるようにした。選択は端末の localStorage に保存。全AI席は同じ強さ（席ごとの混在は将来の拡張）。弱い=手の強さに誤差を加えた緩い判断、中くらい=従来のヒューリスティック、強い=勝率シミュレーション220回＋ポットオッズ、最強=700回＋相手人数・ポット比を考慮したバリューベットとブラフ。どのAIも合法アクションしか選ばない（最終ガード `sanitizeAction`）。AIは自分の手札と公開情報だけを見る。
 - 2026-10-22: **A-2** ベッティング完了判定に「残る1人が支払い不要で、チップを持つ他の生存者がいない」を追加。支払い不要時のフォールドはエンジンで拒否し、UIにもボタンを出さない（コールが必要な場面のみ表示）。強化ファジングは4シード×700ハンド、2〜8人、不均等スタック、オールイン／フォールド多めの4プロファイル。
 - 2026-10-22: **A-3** `pagehide` の `leave` は待機ロビーで、かつ `persisted === false` の場合だけ送る。対戦中のリロード・タブ切替・アプリ切替ではフォールドしない（離席は在席タイムアウトと手番タイマーで扱う）。判定は純粋関数 `shouldLeaveOnPageHide`。
diff -ruN a/docs/UPDATE_NOTES.md b/docs/UPDATE_NOTES.md
--- a/docs/UPDATE_NOTES.md	2026-10-25 14:31:37.341889346 +0000
+++ b/docs/UPDATE_NOTES.md	2026-10-25 14:31:37.348408151 +0000
@@ -145,3 +145,10 @@
 ## 公開前に運営者が確認すること（更新）
 
 運営者名と問い合わせ先は反映済みです。残りは、管轄裁判所、ログ・匿名ID・レート制限の保存期間、データ保存リージョンです（ページ内で黄色の線付きの空欄として表示されます）。
+
+
+## 追記（第3回）
+
+- ルームコード参加：入力の正規化（大小文字・空白・ハイフン・全角）、読み間違えやすい文字の案内、参加後の画面遷移を招待リンク参加と同じ処理に統一。
+- 利用規約・プライバシーポリシーから、運営者が記入する空欄（管轄裁判所、保存期間、保存リージョン）の行を削除。確認できない保存期間などは記載していません。
+- 法務ページの目次の番号重複（「1. 1. …」）を修正。
diff -ruN a/package.json b/package.json
--- a/package.json	2026-10-25 14:31:37.342039752 +0000
+++ b/package.json	2026-10-25 14:31:37.348438748 +0000
@@ -8,7 +8,6 @@
     "dev": "vite",
     "build": "vite build",
     "preview": "vite preview",
-    "capture:design-before": "node scripts/capture-design-before.mjs",
     "test": "node --experimental-strip-types --test test/*.test.ts",
     "typecheck": "tsc --noEmit",
     "test:e2e": "playwright test"
diff -ruN a/src/app/online.ts b/src/app/online.ts
--- a/src/app/online.ts	2026-10-25 14:31:37.343298427 +0000
+++ b/src/app/online.ts	2026-10-25 14:31:37.348705179 +0000
@@ -227,9 +227,15 @@
   }
 }
 
+/** Accepts what people actually type or paste: any case, spaces, hyphens, full-width letters, or "コード: ABC123". */
+export function normalizeRoomCode(raw: string): string {
+  return raw.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/gu, '');
+}
+
 export function joinOnlineRoomByCode(raw: string): void {
-  const code = raw.trim().toUpperCase();
-  if (!/^[A-Z2-9]{6}$/u.test(code)) { online.error = 'ルームコードは6文字の英数字です。'; hooks.render(); return; }
+  const code = normalizeRoomCode(raw);
+  if (code.length !== 6) { online.error = 'ルームコードは6文字です。ホストの画面に表示されているコードを入力してください。'; hooks.render(); return; }
+  if (/[01OIL]/u.test(code)) { online.error = 'ルームコードには 0・1・O・I・L の文字は使われません。読み間違いがないか確認してください。'; hooks.render(); return; }
   const epoch = online.sessionEpoch;
   if (online.pending) return;
   online.pending = true; online.error = ''; hooks.render();
@@ -240,7 +246,8 @@
       if (epoch !== online.sessionEpoch) return;
       window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#room=${room.roomId}`);
       online.invite = '';
-      applyOnlineRoom(room, room.roomId);
+      store.mode = room.status === 'playing' ? 'online-playing' : 'online-lobby';
+      applyOnlineRoom(room);
       startOnlinePolling();
     } catch (error) {
       online.error = error instanceof Error ? error.message : 'ルームに参加できませんでした。';
diff -ruN a/src/style.css b/src/style.css
--- a/src/style.css	2026-10-25 14:31:37.343582251 +0000
+++ b/src/style.css	2026-10-25 14:31:37.348742408 +0000
@@ -738,3 +738,6 @@
 @media (forced-colors: active) {
   .button, .action-button, .seat, .playing-card { border: 1px solid CanvasText; }
 }
+
+/* Legal tables of contents: titles already carry their own numbers (第1条 / 1.), so no automatic list numbers. */
+.legal-toc-list.is-plain { list-style: none; padding-left: 0; }
diff -ruN a/src/ui/legal.ts b/src/ui/legal.ts
--- a/src/ui/legal.ts	2026-10-25 14:31:37.345040915 +0000
+++ b/src/ui/legal.ts	2026-10-25 14:31:37.349004610 +0000
@@ -4,10 +4,9 @@
 /**
  * Draft legal documents. Every statement about data handling is derived from what the code and Supabase
  * schema in this repository actually do. Items that cannot be known from the code are rendered as an
- * explicit blank (`PENDING`) instead of being invented; see docs/LEGAL_REVIEW.md for the pre-launch checklist.
+ * left out rather than invented.
  */
 export const LEGAL_UPDATED = '2026年10月23日';
-const PENDING = '【公開前に運営者が記入：確認できていません】';
 
 type Section = Readonly<{ id: string; title: string; body: readonly string[] }>;
 type LegalDoc = Readonly<{ eyebrow: string; title: string; lead: string; sections: readonly Section[] }>;
@@ -58,7 +57,6 @@
     ] },
     { id: 'law', title: '第9条（準拠法・紛争の解決）', body: [
       '本規約の解釈には、日本法を準拠法とします。',
-      `本サービスに関して紛争が生じた場合の管轄裁判所：${PENDING}`,
     ] },
     { id: 'contact', title: '第10条（運営者・お問い合わせ）', body: [
       '運営者名：Root（astro-root）',
@@ -92,13 +90,11 @@
     ] },
     { id: 'storage', title: '4. 保存する情報と保存期間', body: [
       'ルームの状態：終了したルームは、最後の更新から約1時間、未終了のルームは約24時間を過ぎると削除の対象になります。削除処理は、ルームの作成などの操作をきっかけに実行されるため、実際の削除時刻は前後することがあります。',
-      `匿名ゲストID（認証情報）、利用頻度の制限の記録、各サービスのログの保存期間：${PENDING}`,
       '利用者のブラウザ内には、次の情報が保存されます（運営者のサーバーには送信されません）：ログイン状態（Supabaseのセッション）、表示名、AI対戦の設定、AI対戦の直近のハンド履歴（最大10件）。ブラウザの設定から削除できます。',
     ] },
     { id: 'vendors', title: '5. 外部サービスによる処理', body: [
       'Supabase：匿名認証、データベース、オンライン対戦の処理（Edge Functions）に使用します。上記の情報がSupabaseのサーバーで処理・保存されます。',
       'Vercel：本サービスのウェブサイトの配信に使用します。一般的な配信の仕組みとして、アクセス元のIPアドレス、ブラウザ・端末の情報、アクセス日時などがログとして処理される場合があります。',
-      `これらのサービスの利用地域・設定（データ保存リージョンなど）：${PENDING}`,
       '本サービスのフォントは、サービス自身から配信されており、外部のフォント配信サービスを利用していません。',
     ] },
     { id: 'cookies', title: '6. Cookie・ローカルストレージ・アクセス解析', body: [
@@ -139,7 +135,7 @@
 
 /** Plain text with any https:// address turned into a safe external link (built with DOM nodes, never innerHTML). */
 function paragraphNode(text: string): HTMLElement {
-  const p = node('p', text.includes(PENDING) ? 'legal-pending' : '');
+  const p = node('p', '');
   for (const part of text.split(/(https:\/\/[^\s）)]+)/u)) {
     if (/^https:\/\//u.test(part)) {
       const link = node('a', 'legal-link', part) as HTMLAnchorElement;
@@ -164,7 +160,7 @@
   const toc = node('nav', 'legal-toc');
   toc.setAttribute('aria-label', '目次');
   toc.append(node('h2', 'legal-toc-title', '目次'));
-  const list = node('ol', 'legal-toc-list');
+  const list = node('ol', 'legal-toc-list is-plain');
   for (const section of doc.sections) {
     const item = node('li');
     const link = node('a', '', section.title) as HTMLAnchorElement;
diff -ruN a/src/views/lobby-view.ts b/src/views/lobby-view.ts
--- a/src/views/lobby-view.ts	2026-10-25 14:31:37.345147397 +0000
+++ b/src/views/lobby-view.ts	2026-10-25 14:31:37.349032027 +0000
@@ -136,8 +136,9 @@
     join.addEventListener('click', () => {
       savePlayerName(nameInput.value);
       const value = roomInput.value.trim();
-      const link = value.match(/(?:#room=)?([a-f0-9]{36})$/u);
-      if (link?.[1]) void joinOnlineRoom(link[1]);
+      if (!value) { online.error = '招待リンクまたはルームコードを入力してください。'; hooks.renderLobby(); return; }
+      const link = value.match(/([a-f0-9]{36})\s*$/iu);
+      if (link?.[1]) void joinOnlineRoom(link[1].toLowerCase());
       else joinOnlineRoomByCode(value);
     });
     roomInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') join.click(); });
PATCH_EOF
