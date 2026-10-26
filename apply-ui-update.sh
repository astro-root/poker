#!/usr/bin/env bash
# スマホUI・操作パネルの更新（1本で完結。パッチは内蔵しています）
#   bash apply-ui-update.sh            # dry-run: 何も変更せず、適用できるかだけ確認
#   bash apply-ui-update.sh --execute  # 新しいブランチを作り、適用・検証・コミット・push・PR作成
# origin/main から新しいブランチを切ります。main には直接コミットしません。強制pushはしません。
set -euo pipefail

BRANCH="${BRANCH:-feature/ui-compact}"
BASE="${BASE:-main}"
EXECUTE=0; [ "${1:-}" = "--execute" ] && EXECUTE=1

say()  { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
confirm() { [ "${ASSUME_YES:-0}" = "1" ] && return 0; read -r -p "$1 [y/N] " a; [ "$a" = "y" ] || fail "中止しました。"; }

TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "git リポジトリの中で実行してください。"
cd "$TOP"
grep -q '"name": "poker"' package.json 2>/dev/null || fail "poker リポジトリのルートではありません: $TOP"

TMP="$(mktemp -d)"; trap 'git worktree remove --force "$TMP/wt" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
sed -n '/^: <<'"'"'PATCH_EOF'"'"'$/,/^PATCH_EOF$/p' "$0" | sed '1d;$d' > "$TMP/ui.patch"
sed -n '/^: <<'"'"'NOTES_EOF'"'"'$/,/^NOTES_EOF$/p' "$0" | sed '1d;$d' > "$TMP/notes.md"
[ -s "$TMP/ui.patch" ] && [ -s "$TMP/notes.md" ] || fail "内蔵データを取り出せませんでした。スクリプトが壊れています。"

say "origin/$BASE を取得して、適用できるか確認"
git fetch origin "$BASE" || fail "git fetch に失敗しました（ネットワーク・認証を確認）。"
git worktree add -q --detach "$TMP/wt" "origin/$BASE"
( cd "$TMP/wt" && git apply --check -p1 "$TMP/ui.patch" ) \
  || fail "パッチを origin/$BASE に適用できません。origin/$BASE が想定と違います。前回までのPRをマージ済みか確認し、この出力を共有してください。"
ok "origin/$BASE に適用できます"
git --no-pager apply --stat -p1 "$TMP/ui.patch" | sed 's/^/  /'
if [ "$EXECUTE" != "1" ]; then echo; echo "(dry-run: 何も変更していません。--execute で実行します)"; exit 0; fi

say "実行"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then git status --short --untracked-files=no | sed 's/^/  /'; fail "未コミットの変更があります。コミットか git stash をしてから再実行してください。"; fi
git show-ref --verify --quiet "refs/heads/$BRANCH" && fail "ブランチ $BRANCH は既に存在します。BRANCH=別名 で再実行してください。"
confirm "origin/$BASE から $BRANCH を作り、適用します。よろしいですか？"
git switch -c "$BRANCH" "origin/$BASE"
git apply -p1 "$TMP/ui.patch"; ok "UI修正を適用"
if [ -f docs/UPDATE_NOTES.md ] && ! grep -q "第4回：スマホUI・操作パネル" docs/UPDATE_NOTES.md; then
  { printf '\n\n---\n\n'; cat "$TMP/notes.md"; } >> docs/UPDATE_NOTES.md; ok "docs/UPDATE_NOTES.md に追記"
fi

if [ "${SKIP_CHECKS:-0}" != "1" ]; then
  say "検証"
  [ -d node_modules ] || npm ci
  npm run typecheck; npm test; npm run build
  ok "検証に成功しました"
fi

say "コミットと push"
git add -u; git add src/ui/icons.ts test/e2e/play-ui.spec.ts   # 追跡済みの変更と、新規の2ファイルだけ（他の未追跡ファイルは触らない）
git --no-pager diff --cached --stat | tail -4
confirm "コミットして push しますか？（強制 push ではありません）"
git commit -q -m "feat(ui): compact mobile layout, pinned action dock, icon controls, translucent menu, in-place rename"
git push -u origin "$BRANCH" || fail "push に失敗しました。認証を確認してください（コミットはローカルに残っています）。"
ok "push しました: origin/$BRANCH"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh pr create --base "$BASE" --head "$BRANCH" --title "feat(ui): スマホUIの最適化と操作パネルの固定" --body-file "$TMP/notes.md" && ok "PR を作成しました"
else
  echo "  次の URL から PR を作成してください:"
  echo "  $(git remote get-url origin | sed -E 's#^git@github.com:#https://github.com/#; s#\.git$##')/compare/$BASE...$BRANCH?expand=1"
fi
exit 0

: <<'NOTES_EOF'
## 追記（第4回：スマホUI・操作パネル）

- 操作パネル：常に画面下に固定（スマホは「ページ末尾のstickyな要素」として実装）。自分の番でないときは同じボタンを無効化した状態で表示（押せない・見た目も薄く）。
- 名前変更：チャットの過去メッセージにも反映（名簿から都度解決）。AI対戦にもゲーム中の「名前を変更」を追加。**「設定を変更」はゲームが新規になるため、確認ダイアログを追加**（これまでの「名前を変えるとリセットされる」の原因）。ロビーの入力欄は、ポーリングの再描画で消えないよう下書きを保持。
- ハンバーガーメニュー：ヘッダーの下に重なる半透明のオーバーレイにし、ページを押し下げない。外側タップ・Escで閉じる。
- 余白とサイズ：カード・座席・ボタンを縮小、プレイ画面の最大幅を拡大、座席は幅に応じて自動で折り返し。ヘッダーの操作はSVGアイコン化（狭い画面ではラベルを非表示。aria-labelは維持）。
- チャットボタンはSVGアイコン。スマホでは固定パネルの上に浮かせる。

**未確認**：実機・ブラウザでの見た目は未確認です（この環境にブラウザがありません）。`test/e2e/play-ui.spec.ts` は追加しましたが未実行です。

NOTES_EOF

: <<'PATCH_EOF'
diff -ruN a/src/app/state.ts b/src/app/state.ts
--- a/src/app/state.ts	2026-10-26 23:36:02.529159499 +0000
+++ b/src/app/state.ts	2026-10-26 23:36:02.533422828 +0000
@@ -111,6 +111,9 @@
     settings: DEFAULT_SETTINGS as RoomSettings,
     settingsVersion: 0,
     code: '' as string,
+    /** Text typed in the lobby inputs but not yet submitted; survives the re-renders caused by polling. */
+    nameDraft: '',
+    joinDraft: '',
     chat: [] as ChatMessage[],
     /** Highest chat id the player has seen; anything newer is shown as unread. */
     chatSeen: 0,
diff -ruN a/src/main.ts b/src/main.ts
--- a/src/main.ts	2026-10-26 23:36:02.529895920 +0000
+++ b/src/main.ts	2026-10-26 23:36:02.534155829 +0000
@@ -34,6 +34,9 @@
   draw();
   for (const [key, top] of inner) { const el = root.querySelector<HTMLElement>(`[data-scroll-key="${key}"]`); if (el) el.scrollTop = top; }
   if (Math.abs(window.scrollY - y) > 1) window.scrollTo({ top: y, behavior: 'instant' });
+  // The chat button floats above the pinned action dock on phones; tell the CSS how tall the dock is.
+  const dock = root.querySelector<HTMLElement>('.dock');
+  document.documentElement.style.setProperty('--dock-h', dock && window.matchMedia('(max-width: 819.98px)').matches ? `${dock.offsetHeight}px` : '0px');
   if (active) document.getElementById(active)?.focus({ preventScroll: true });
   updateChatWidget();
 }
diff -ruN a/src/style.css b/src/style.css
--- a/src/style.css	2026-10-26 23:36:02.529194095 +0000
+++ b/src/style.css	2026-10-26 23:36:02.534175295 +0000
@@ -731,6 +731,98 @@
 }
 @media (min-width: 1100px) { .chat-panel { width: 360px; } }
 
+/* ═══ Compact, space-efficient layout (mobile first) ═══════════════ */
+:root { --gutter: clamp(10px, 2.6vw, 36px); --maxw: 1280px; }
+
+/* Header: icon-sized controls and a translucent overlay menu that never pushes the page down. */
+.play-page .site-header { position: relative; }
+.site-header-inner { padding-top: 6px; padding-bottom: 6px; position: relative; }
+.site-header.is-menu-open { backdrop-filter: none; -webkit-backdrop-filter: none; background: rgba(9, 9, 11, 0.55); }
+@media (max-width: 760px) {
+  .page-nav {
+    position: absolute; top: 100%; left: 0; right: 0; z-index: 60; flex: none; margin: 0;
+    padding: 8px var(--gutter) 14px; max-height: calc(100dvh - 60px); overflow-y: auto;
+    background: rgba(9, 9, 11, 0.72);
+    backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3);
+    border-bottom: 1px solid var(--line-strong); box-shadow: 0 22px 44px rgba(0, 0, 0, 0.5);
+  }
+  .page-nav-link { background: rgba(255, 255, 255, 0.04); }
+  .page-nav-link[aria-current='page'] { background: var(--gold-soft); }
+}
+
+/* Icon buttons: the label is for screen readers and tooltips once the screen is narrow. */
+.icon-btn { position: relative; display: inline-flex; align-items: center; gap: 6px; }
+.icon-btn .icon { flex: none; }
+@media (max-width: 640px) {
+  .icon-btn .btn-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
+  .icon-btn { width: 40px; min-width: 40px; height: 40px; min-height: 40px; padding: 0; justify-content: center; }
+  .status-controls { gap: 4px; }
+}
+
+/* Play page: use the width that is there, and stay compact. */
+.play { max-width: 1560px; padding-top: 10px; }
+.play-main { gap: 8px; }
+.table-status { gap: 6px 10px; }
+.status-meta { font-size: 13px; gap: 2px 10px; }
+.turn-badge { padding: 4px 12px; font-size: 13px; }
+.notice { padding: 7px 12px; min-height: 38px; }
+@media (min-width: 820px) {
+  .play-layout { grid-template-columns: minmax(0, 1fr) clamp(340px, 30vw, 460px); gap: 16px; }
+}
+
+/* Smaller cards and seats; desktop gets its larger sizes back. */
+.card-lg { --cw: 50px; --ch: 70px; font-size: 21px; }
+.card-md { --cw: 42px; --ch: 59px; font-size: 18px; }
+.card-sm { --cw: 33px; --ch: 46px; font-size: 14px; }
+.card-xs { --cw: 22px; --ch: 31px; font-size: 11px; }
+@media (min-width: 820px) {
+  .card-lg { --cw: 60px; --ch: 84px; font-size: 25px; }
+  .card-md { --cw: 50px; --ch: 70px; font-size: 21px; }
+  .hero-cards .card-lg { --cw: 66px; --ch: 92px; font-size: 28px; }
+}
+@container felt (max-width: 639px) {
+  .felt { padding: 8px; gap: 8px; border-radius: var(--radius); }
+  /* As many seats per row as fit; never squeezed below a readable width. */
+  .seats { grid-template-columns: repeat(auto-fit, minmax(88px, 1fr)); gap: 6px; }
+  .seat { padding: 6px 7px 8px; gap: 3px; }
+  .seat-avatar { display: none; }
+  .seat-name { font-size: 13px; }
+  .seat-stack-value { font-size: 14px; }
+  .seat-bet, .seat-state { font-size: 12px; }
+  .seat-last { font-size: 11px; line-height: 1.25; overflow-wrap: anywhere; }
+  .pot { padding: 4px 12px; }
+  .pot-value { font-size: var(--text-md); }
+  .board { gap: 4px; }
+}
+.seat-name, .hero-name { min-width: 0; }
+
+/* Action dock: pinned to the bottom of the screen on phones (see the layout rule below), always visible. */
+.dock { gap: 8px; padding-top: 8px; padding-bottom: calc(8px + env(safe-area-inset-bottom)); }
+.dock-hand { gap: 10px; }
+.hero-name { font-size: var(--text-md); }
+.action-button { min-height: 46px; padding: 4px 6px; font-size: 15px; }
+.action-row { gap: 6px; }
+.dock-stats .stat-chip { padding: 1px 8px; }
+.dock-waiting { padding: 0; font-size: 13px; min-height: 1.3em; }
+.action-row.is-idle .action-button { opacity: 0.38; pointer-events: none; }
+@media (max-width: 819.98px) {
+  /* Dock is the last flex item of the page column, so "sticky bottom" holds for the whole scroll. */
+  .play { display: flex; flex-direction: column; gap: 10px; }
+  .play-layout { display: contents; }
+  .play-main { order: 1; }
+  .play-info { order: 2; }
+  .dock { order: 3; }
+  .play { padding-bottom: 0; }
+}
+@media (max-width: 520px) {
+  .hero-cards .card-lg { --cw: 44px; --ch: 62px; font-size: 19px; }
+  .hero-stack, .hero-made { font-size: 13px; }
+}
+
+/* Chat sits above the pinned dock on phones. */
+.chat-widget { bottom: calc(max(12px, env(safe-area-inset-bottom)) + var(--dock-h, 0px)); }
+.chat-toggle { display: grid; place-items: center; color: var(--gold-bright); width: 46px; height: 46px; }
+
 @media (prefers-reduced-motion: reduce) {
   *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
   .js-reveal .reveal { opacity: 1; transform: none; }
diff -ruN a/src/ui/chat-widget.ts b/src/ui/chat-widget.ts
--- a/src/ui/chat-widget.ts	2026-10-26 23:36:02.529777795 +0000
+++ b/src/ui/chat-widget.ts	2026-10-26 23:36:02.534012184 +0000
@@ -2,6 +2,7 @@
 import { hooks, store } from '../app/state.ts';
 import { markChatSeen, sendChat } from '../app/online.ts';
 import { CHAT_EMOJI } from '../supabase/online-room.ts';
+import { icon } from './icons.ts';
 
 /**
  * Room chat and quick emoji reactions. It lives on document.body, outside the re-rendered app root, so the
@@ -17,11 +18,16 @@
 let input: HTMLInputElement;
 let renderedUpTo = 0;
 let toastedUpTo = -1;
+let renderedNamesKey = '';
+
+/** Names come from the live room roster, so a rename shows up on messages sent before it too. */
+const nameOf = (message: { from: string; name: string }): string => (message.from === store.humanId ? 'あなた' : online.names.get(message.from) ?? message.name);
 
 function build(): HTMLElement {
   const wrap = node('div', 'chat-widget');
-  toggle = node('button', 'chat-toggle', '💬');
+  toggle = node('button', 'chat-toggle');
   toggle.type = 'button';
+  toggle.append(icon('chat', 22));
   toggle.setAttribute('aria-label', 'チャットを開く');
   toggle.setAttribute('aria-expanded', 'false');
   badge = node('span', 'chat-badge');
@@ -80,16 +86,18 @@
 /** Re-syncs the widget with the online store. Cheap and idempotent; called after every room update. */
 export function updateChatWidget(): void {
   const visible = Boolean(online.roomId) && (store.mode === 'online-lobby' || store.mode === 'online-playing');
-  if (!visible) { root?.remove(); root = null; renderedUpTo = 0; toastedUpTo = -1; return; }
+  if (!visible) { root?.remove(); root = null; renderedUpTo = 0; toastedUpTo = -1; renderedNamesKey = ''; return; }
   if (!root) { root = build(); document.body.append(root); }
   const messages = online.chat;
   const last = messages.at(-1)?.id ?? 0;
   if (toastedUpTo < 0) toastedUpTo = last; // do not pop up history when first joining
-  if (last !== renderedUpTo || list.childElementCount !== messages.length) {
+  const namesKey = [...online.names].map(([id, name]) => `${id}:${name}`).join('|');
+  if (last !== renderedUpTo || list.childElementCount !== messages.length || namesKey !== renderedNamesKey) {
+    renderedNamesKey = namesKey;
     const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
     list.replaceChildren(...messages.map((message) => {
       const item = node('li', `chat-item${message.from === store.humanId ? ' is-me' : ''}${message.kind === 'emoji' ? ' is-emoji' : ''}`);
-      const who = node('span', 'chat-name', message.from === store.humanId ? 'あなた' : message.name);
+      const who = node('span', 'chat-name', nameOf(message));
       item.append(who, node('span', 'chat-text', message.text)); // textContent only: never HTML
       return item;
     }));
@@ -102,7 +110,7 @@
     toastedUpTo = Math.max(toastedUpTo, message.id);
     if (message.from === store.humanId || online.chatOpen) continue;
     const toast = node('div', `chat-toast${message.kind === 'emoji' ? ' is-emoji' : ''}`);
-    toast.append(node('strong', '', message.name), document.createTextNode(` ${message.text}`));
+    toast.append(node('strong', '', nameOf(message)), document.createTextNode(` ${message.text}`));
     toasts.append(toast);
     window.setTimeout(() => toast.remove(), 4_000);
     while (toasts.childElementCount > 3) toasts.firstElementChild?.remove();
diff -ruN a/src/ui/header.ts b/src/ui/header.ts
--- a/src/ui/header.ts	2026-10-26 23:36:02.529701773 +0000
+++ b/src/ui/header.ts	2026-10-26 23:36:02.533931089 +0000
@@ -52,7 +52,22 @@
 /** Remembered across the full re-renders that the game views perform, so an open menu does not snap shut. */
 let menuOpen = false;
 
+let outsideListenerInstalled = false;
+function installOutsideClose(): void {
+  if (outsideListenerInstalled) return;
+  outsideListenerInstalled = true;
+  document.addEventListener('pointerdown', (event) => {
+    if (!menuOpen) return;
+    const header = document.querySelector<HTMLElement>('.site-header');
+    if (header && event.target instanceof Node && header.contains(event.target)) return;
+    menuOpen = false;
+    header?.classList.remove('is-menu-open');
+    header?.querySelector('.nav-toggle')?.setAttribute('aria-expanded', 'false');
+  });
+}
+
 export function siteHeader(page: SitePage): HTMLElement {
+  installOutsideClose();
   const header = node('header', 'site-header');
   const inner = node('div', 'site-header-inner');
   const nav = node('nav', 'page-nav');
diff -ruN a/src/ui/icons.ts b/src/ui/icons.ts
--- a/src/ui/icons.ts	1970-01-01 00:00:00.000000000 +0000
+++ b/src/ui/icons.ts	2026-10-26 23:36:02.534029210 +0000
@@ -0,0 +1,61 @@
+import { node } from './dom.ts';
+
+/** Small inline SVG icons (stroke-based, inheriting the text colour). Icons save horizontal space on phones. */
+const SVG_NS = 'http://www.w3.org/2000/svg';
+
+type Shape = Readonly<{ d?: string; circle?: readonly [number, number, number] }>;
+const ICONS: Readonly<Record<string, readonly Shape[]>> = {
+  settings: [{ d: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1' }, { circle: [15, 6, 2] }, { circle: [9, 12, 2] }, { circle: [17, 18, 2] }],
+  rename: [{ d: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z' }, { d: 'M14 7l3 3' }],
+  leave: [{ d: 'M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4' }, { d: 'M16 8l4 4-4 4M20 12H9' }],
+  info: [{ circle: [12, 12, 9] }, { d: 'M12 11v5M12 8h.01' }],
+  chat: [{ d: 'M4 5h16v11H9l-5 4V5z' }],
+  users: [{ circle: [9, 8, 3] }, { d: 'M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5' }, { circle: [17, 9, 2.5] }, { d: 'M17 14c2.6 0 4 1.5 4 4' }],
+  eye: [{ d: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z' }, { circle: [12, 12, 3] }],
+  copy: [{ d: 'M9 9h10v11H9z' }, { d: 'M5 15V4h10' }],
+  chip: [{ circle: [12, 12, 9] }, { circle: [12, 12, 4] }, { d: 'M12 3v2M12 19v2M3 12h2M19 12h2' }],
+  close: [{ d: 'M6 6l12 12M18 6L6 18' }],
+};
+
+export function icon(name: keyof typeof ICONS | string, size = 18): SVGSVGElement {
+  const svg = document.createElementNS(SVG_NS, 'svg');
+  svg.setAttribute('viewBox', '0 0 24 24');
+  svg.setAttribute('width', String(size));
+  svg.setAttribute('height', String(size));
+  svg.setAttribute('fill', 'none');
+  svg.setAttribute('stroke', 'currentColor');
+  svg.setAttribute('stroke-width', '1.8');
+  svg.setAttribute('stroke-linecap', 'round');
+  svg.setAttribute('stroke-linejoin', 'round');
+  svg.setAttribute('aria-hidden', 'true');
+  svg.setAttribute('focusable', 'false');
+  svg.classList.add('icon');
+  for (const shape of ICONS[name] ?? []) {
+    if (shape.d) { const path = document.createElementNS(SVG_NS, 'path'); path.setAttribute('d', shape.d); svg.append(path); }
+    if (shape.circle) {
+      const c = document.createElementNS(SVG_NS, 'circle');
+      c.setAttribute('cx', String(shape.circle[0])); c.setAttribute('cy', String(shape.circle[1])); c.setAttribute('r', String(shape.circle[2]));
+      svg.append(c);
+    }
+  }
+  return svg;
+}
+
+/** A compact button: icon plus a text label that is hidden on narrow screens (kept for screen readers and tooltips). */
+export function iconButton(name: string, label: string, extraClass = 'button-ghost'): HTMLButtonElement {
+  const button = node('button', `button button-small icon-btn ${extraClass}`);
+  button.type = 'button';
+  button.title = label;
+  button.setAttribute('aria-label', label);
+  button.append(icon(name), node('span', 'btn-label', label));
+  return button;
+}
+
+export function iconLink(name: string, label: string, href: string): HTMLAnchorElement {
+  const link = node('a', 'button button-small icon-btn button-ghost') as HTMLAnchorElement;
+  link.href = href;
+  link.title = label;
+  link.setAttribute('aria-label', label);
+  link.append(icon(name), node('span', 'btn-label', label));
+  return link;
+}
diff -ruN a/src/views/lobby-view.ts b/src/views/lobby-view.ts
--- a/src/views/lobby-view.ts	2026-10-26 23:36:02.529810442 +0000
+++ b/src/views/lobby-view.ts	2026-10-26 23:36:02.534067639 +0000
@@ -82,8 +82,10 @@
   const nameRow = node('div', 'inline-row');
   const nameInput = node('input', 'text-input');
   nameInput.type = 'text';
-  nameInput.value = store.playerName;
+  nameInput.id = 'player-name-input';
+  nameInput.value = online.nameDraft || store.playerName;
   nameInput.maxLength = 40;
+  nameInput.addEventListener('input', () => { online.nameDraft = nameInput.value; });
   nameInput.setAttribute('autocomplete', 'nickname');
   nameInput.addEventListener('change', () => {
     if (online.roomId) return;
@@ -94,7 +96,7 @@
   if (online.roomId) {
     const rename = node('button', 'button button-secondary', '変更');
     rename.type = 'button';
-    rename.addEventListener('click', () => renameSelf(nameInput.value));
+    rename.addEventListener('click', () => { const value = nameInput.value; online.nameDraft = ''; renameSelf(value); });
     nameRow.append(rename);
   }
   nameField.append(nameRow);
@@ -127,6 +129,9 @@
     panel.append(create, quick, node('div', 'divider', '招待リンクまたはルームコードで参加'));
     const joinRow = node('div', 'inline-row');
     const roomInput = node('input', 'text-input');
+    roomInput.id = 'room-join-input';
+    roomInput.value = online.joinDraft;
+    roomInput.addEventListener('input', () => { online.joinDraft = roomInput.value; });
     roomInput.placeholder = '招待リンク / ルームコード（例: K7M2QX）';
     roomInput.setAttribute('aria-label', '招待リンクまたはルームコード');
     roomInput.autocapitalize = 'characters';
diff -ruN a/src/views/table-view.ts b/src/views/table-view.ts
--- a/src/views/table-view.ts	2026-10-26 23:36:02.529851384 +0000
+++ b/src/views/table-view.ts	2026-10-26 23:36:02.534112406 +0000
@@ -16,6 +16,7 @@
 import { closeOnlineSession, renameSelf, requestNextOnlineHand, requestRematch } from '../app/online.ts';
 import type { HandActionRecord } from '../poker/hand.ts';
 import { openHostSettings } from './lobby-view.ts';
+import { iconButton, iconLink } from '../ui/icons.ts';
 
 const online = store.online;
 
@@ -91,34 +92,27 @@
   statusBar.append(meta, turn);
   const controls = node('div', 'status-controls');
   if (isOnline) {
-    const info = node('a', 'button button-ghost button-small', 'ルーム情報') as HTMLAnchorElement;
-    info.href = `/online#room=${online.roomId}`;
-    const leave = node('button', 'button button-danger-ghost button-small', '退出');
-    leave.type = 'button';
+    const info = iconLink('info', 'ルーム情報', `/online#room=${online.roomId}`);
+    const leave = iconButton('leave', '退出', 'button-danger-ghost');
     leave.title = online.role === 'spectator' ? '観戦をやめます' : '退出するとこのハンドはフォールドになり、席は離席扱いになります';
     leave.addEventListener('click', () => {
       if (online.role !== 'spectator' && !window.confirm('退出するとこのハンドはフォールドになり、離席扱いになります。退出しますか？')) return;
       void closeOnlineSession().finally(() => { window.location.assign('/online'); });
     });
-    const rename = node('button', 'button button-ghost button-small', '名前変更');
-    rename.type = 'button';
-    rename.addEventListener('click', () => {
-      const next = window.prompt('新しい表示名（20文字以内）', store.playerName);
-      if (next !== null) renameSelf(next);
-    });
-    controls.append(info, rename);
+    controls.append(info, renameButton());
     if (online.host) {
-      const settings = node('button', 'button button-ghost button-small', '設定');
-      settings.type = 'button';
+      const settings = iconButton('settings', 'ルーム設定');
       settings.addEventListener('click', openHostSettings);
       controls.append(settings);
     }
     controls.append(leave);
   } else {
-    const setup = node('button', 'button button-ghost button-small', '設定を変更');
-    setup.type = 'button';
-    setup.addEventListener('click', backToSetup);
-    controls.append(setup);
+    // Changing the name in place keeps the game running; "設定を変更" goes back to setup and starts a NEW game.
+    const setup = iconButton('settings', '設定を変更（新しいゲーム）');
+    setup.addEventListener('click', () => {
+      if (window.confirm('設定を変更すると、現在のゲームは終了して新しいゲームになります。よろしいですか？')) backToSetup();
+    });
+    controls.append(renameButton(), setup);
   }
   statusBar.append(controls);
   stage.append(statusBar);
@@ -264,6 +258,16 @@
 
 type DockArgs = Readonly<{ legal: LegalActions | null; humanTurn: boolean; pot: number; round: BettingRound | null }>;
 
+/** Renames the player without touching the game: online it goes through the server, offline it only changes the label. */
+function renameButton(): HTMLButtonElement {
+  const rename = iconButton('rename', '名前を変更');
+  rename.addEventListener('click', () => {
+    const next = window.prompt('新しい表示名（20文字以内）', store.playerName);
+    if (next !== null) renameSelf(next);
+  });
+  return rename;
+}
+
 function renderDock(args: DockArgs): HTMLElement {
   const table = store.table!;
   const hand = table.hand!;
@@ -320,13 +324,32 @@
   } else if (legal && round && me) {
     actions.append(...renderActionControls(legal, round.currentBet, me.stack, pot, pending));
   } else {
-    const waiting = node('p', 'dock-waiting', me?.folded ? 'このハンドは終了しました。次のハンドをお待ちください。' : '順番が来ると、ここに操作ボタンが表示されます。');
-    actions.append(waiting);
+    // The panel never disappears: out of turn the same controls stay in place, greyed out and not pressable.
+    const who = round?.actorId ? `${playerLabel(round.actorId)}の番です` : '';
+    const note = me?.folded ? 'このハンドは終了しました。次のハンドをお待ちください。' : who || 'ほかのプレイヤーの手番です。';
+    actions.append(...renderIdleControls(pot, note));
   }
   dock.append(actions);
   return dock;
 }
 
+function renderIdleControls(pot: number, note: string): HTMLElement[] {
+  const stats = node('div', 'dock-stats');
+  stats.append(chip('ポット', formatChips(pot)), chip('コール額', '—'));
+  const row = node('div', 'action-row is-idle');
+  for (const [label, tone] of [['フォールド', 'fold'], ['チェック', 'neutral'], ['レイズ', 'raise'], ['オールイン', 'allin']] as const) {
+    const button = node('button', `action-button tone-${tone}`);
+    button.type = 'button';
+    button.disabled = true;
+    button.setAttribute('aria-disabled', 'true');
+    button.append(node('span', 'action-label', label));
+    row.append(button);
+  }
+  const status = node('p', 'dock-waiting', note);
+  status.setAttribute('role', 'status');
+  return [stats, row, status];
+}
+
 function renderActionControls(legal: LegalActions, currentBet: number, myStack: number, pot: number, pending: boolean): HTMLElement[] {
   const out: HTMLElement[] = [];
   const raiseLabel = currentBet === 0 ? 'ベット' : 'レイズ';
diff -ruN a/test/e2e/play-ui.spec.ts b/test/e2e/play-ui.spec.ts
--- a/test/e2e/play-ui.spec.ts	1970-01-01 00:00:00.000000000 +0000
+++ b/test/e2e/play-ui.spec.ts	2026-10-26 23:36:02.534622172 +0000
@@ -0,0 +1,49 @@
+import { expect, test } from '@playwright/test';
+import { startAiTable } from './helpers.ts';
+
+test.use({ viewport: { width: 375, height: 740 } });
+
+test('the action dock stays pinned to the bottom of the screen while the page scrolls', async ({ page }) => {
+  await startAiTable(page, 2, 5);
+  const dock = page.locator('.dock');
+  await expect(dock).toBeVisible();
+  for (const y of [0, 400, 1200]) {
+    await page.evaluate((top) => window.scrollTo(0, top), y);
+    const box = (await dock.boundingBox())!;
+    expect(Math.round(box.y + box.height), `dock bottom at scrollY=${y}`).toBeGreaterThanOrEqual(740 - 2);
+  }
+});
+
+test('out of turn the controls stay visible but cannot be pressed', async ({ page }) => {
+  await startAiTable(page, 2, 5);
+  // Wait for a moment that is not our turn (the AI acts quickly, so poll briefly).
+  await expect.poll(async () => page.locator('.dock.is-your-turn').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(0);
+  const waiting = page.locator('.dock:not(.is-your-turn) .action-row .action-button');
+  if (await waiting.count()) {
+    for (const button of await waiting.all()) await expect(button).toBeDisabled();
+  }
+});
+
+test('renaming in the middle of a game keeps the same hand and the same game', async ({ page }) => {
+  await startAiTable(page, 2, 3);
+  const hand = await page.locator('.status-hand').first().innerText();
+  page.once('dialog', (dialog) => { void dialog.accept('Nova'); });
+  await page.getByRole('button', { name: '名前を変更' }).click();
+  await expect(page.locator('.hero-name')).toHaveText('Nova');
+  await expect(page.locator('.status-hand').first()).toHaveText(hand);
+});
+
+test('the phone menu is a translucent overlay: opening it does not move the page or the content', async ({ page }) => {
+  await page.goto('/rules');
+  await page.evaluate(() => window.scrollTo(0, 300));
+  const before = await page.evaluate(() => ({ y: window.scrollY, h: document.documentElement.scrollHeight, top: document.querySelector('main')!.getBoundingClientRect().top }));
+  await page.locator('.nav-toggle').click();
+  const nav = page.locator('.page-nav');
+  await expect(nav).toBeVisible();
+  const after = await page.evaluate(() => ({ y: window.scrollY, h: document.documentElement.scrollHeight, top: document.querySelector('main')!.getBoundingClientRect().top }));
+  expect(after).toEqual(before);
+  const alpha = await nav.evaluate((el) => Number((getComputedStyle(el).backgroundColor.match(/[\d.]+/gu) ?? [])[3] ?? 1));
+  expect(alpha).toBeLessThan(1);
+  await page.mouse.click(200, 700); // tapping outside closes it
+  await expect(nav).toBeHidden();
+});
PATCH_EOF
