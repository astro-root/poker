import '@fontsource-variable/noto-sans-jp';
import './style.css';
import { initializeGuestIdentity } from './supabase/client.ts';
import { hooks, store } from './app/state.ts';
import { installLifecycleHandlers, joinOnlineRoom } from './app/online.ts';
import { renderGlossaryPage, renderHandsPage, renderHomePage, type SitePage } from './ui/pages.ts';
import { renderLegalPage } from './ui/legal.ts';
import { renderPracticeSetup } from './views/setup-view.ts';
import { renderOnlineLobby } from './views/lobby-view.ts';
import { renderPlayView } from './views/table-view.ts';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Application root is missing');
const root: HTMLElement = app;

const routePath = window.location.pathname.replace(/\/+$/u, '') || '/';
const sitePage: SitePage = routePath === '/ai' ? 'ai'
  : routePath === '/online' ? 'online'
    : routePath === '/glossary' ? 'glossary'
      : routePath === '/terms' ? 'terms'
        : routePath === '/privacy' ? 'privacy'
          : routePath === '/hands' ? 'hands' : 'home';

function render(): void {
  if (store.mode === 'online-lobby') { renderOnlineLobby(root); return; }
  if (store.mode === 'practice' && !store.practiceStarted) { renderPracticeSetup(root); return; }
  renderPlayView(root);
}
hooks.render = render;
hooks.renderLobby = () => renderOnlineLobby(root);

// Keyboard play: F fold, C check/call, R raise, A all-in, N next hand. Ignored while typing in a field.
window.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
  const button = root.querySelector<HTMLButtonElement>(`button[data-shortcut="${event.key.toLowerCase()}"]:not(:disabled)`);
  if (button) { event.preventDefault(); button.click(); }
});

installLifecycleHandlers();

// One-time page entrance: the views re-render on every state change, so this must not live on the render path.
document.documentElement.classList.add('is-booting');
window.setTimeout(() => document.documentElement.classList.remove('is-booting'), 700);

if (sitePage === 'home') renderHomePage(root, sitePage);
else if (sitePage === 'glossary') renderGlossaryPage(root, sitePage);
else if (sitePage === 'terms' || sitePage === 'privacy') renderLegalPage(root, sitePage);
else if (sitePage === 'hands') renderHandsPage(root, sitePage);
else void initializeGuestIdentity().then(async ({ guestId, onlineReady }) => {
  store.humanId = guestId;
  store.guestOnlineReady = onlineReady;
  // Development-only fixtures. The constant condition lets the bundler drop this branch (and the module) in production.
  if (import.meta.env.DEV && sitePage === 'online') {
    const mock = new URLSearchParams(window.location.search).get('mock');
    if (mock) {
      const { applyMockOnline } = await import('./app/mock-online.ts');
      if (applyMockOnline(mock) === 'room') return;
    }
  }
  if (sitePage === 'online') {
    store.mode = 'online-lobby';
    const inviteId = window.location.hash.match(/^#room=([a-f0-9]{36})$/u)?.[1];
    render();
    if (inviteId) void joinOnlineRoom(inviteId);
  } else render();
}).catch(() => {
  // Keep practice available during an auth outage; online room actions will require a valid session.
  store.humanId = globalThis.crypto.randomUUID();
  store.guestError = true;
  if (sitePage === 'online') {
    store.mode = 'online-lobby';
    store.online.error = 'オンライン対戦に接続できません。Supabaseの設定と接続を確認してください。';
  }
  render();
});

