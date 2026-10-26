import '@fontsource-variable/noto-sans-jp';
import './style.css';
import { initializeGuestIdentity } from './supabase/client.ts';
import { hooks, store } from './app/state.ts';
import { installLifecycleHandlers } from './app/online.ts';
import { renderGlossaryPage, renderHandsPage, renderHomePage, renderRulesPage, type SitePage } from './ui/pages.ts';
import { renderLegalPage } from './ui/legal.ts';
import { updateChatWidget } from './ui/chat-widget.ts';
import { renderPracticeSetup } from './views/setup-view.ts';
import { renderOnlineLobby } from './views/lobby-view.ts';
import { renderPlayView } from './views/table-view.ts';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Application root is missing');
const root: HTMLElement = app;

const routePath = window.location.pathname.replace(/\/+$/u, '') || '/';
const sitePage: SitePage = routePath === '/ai' ? 'ai'
  : routePath === '/online' ? 'online'
    : routePath === '/rules' ? 'rules'
    : routePath === '/glossary' ? 'glossary'
      : routePath === '/terms' ? 'terms'
        : routePath === '/privacy' ? 'privacy'
          : routePath === '/hands' ? 'hands' : 'home';

/**
 * Every view rebuilds the page. Keep the reader exactly where they were: without this, content that
 * changes height between turns (action buttons, result panel, log) made the page jump on each action.
 */
function keepingScroll(draw: () => void): void {
  const y = window.scrollY;
  const inner = [...root.querySelectorAll<HTMLElement>('[data-scroll-key]')].map((el) => [el.dataset.scrollKey!, el.scrollTop] as const);
  const active = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
  draw();
  for (const [key, top] of inner) { const el = root.querySelector<HTMLElement>(`[data-scroll-key="${key}"]`); if (el) el.scrollTop = top; }
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo({ top: y, behavior: 'instant' });
  // The chat button floats above the pinned action dock on phones; tell the CSS how tall the dock is.
  const dock = root.querySelector<HTMLElement>('.dock');
  document.documentElement.style.setProperty('--dock-h', dock && window.matchMedia('(max-width: 819.98px)').matches ? `${dock.offsetHeight}px` : '0px');
  if (active) document.getElementById(active)?.focus({ preventScroll: true });
  updateChatWidget();
}

function render(): void {
  keepingScroll(() => {
    if (store.mode === 'online-lobby') { renderOnlineLobby(root); return; }
    if (store.mode === 'practice' && !store.practiceStarted) { renderPracticeSetup(root); return; }
    renderPlayView(root);
  });
}
hooks.render = render;
hooks.renderLobby = () => keepingScroll(() => renderOnlineLobby(root));

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

/** Fade static content in as it scrolls into view. Skipped for reduced motion; content is never hidden without JS. */
function initReveal(): void {
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const targets = root.querySelectorAll<HTMLElement>('.legal-section, .reveal, .mode-row, .level-card, .section, .term-card, .hand-card, .content-bottom-nav');
  document.documentElement.classList.add('js-reveal');
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  for (const element of targets) { element.classList.add('reveal'); observer.observe(element); }
}

if (sitePage === 'home') renderHomePage(root, sitePage);
else if (sitePage === 'glossary') renderGlossaryPage(root, sitePage);
else if (sitePage === 'terms' || sitePage === 'privacy') renderLegalPage(root, sitePage);
else if (sitePage === 'hands') renderHandsPage(root, sitePage);
else if (sitePage === 'rules') renderRulesPage(root, sitePage);
if (sitePage === 'home' || sitePage === 'glossary' || sitePage === 'terms' || sitePage === 'privacy' || sitePage === 'hands' || sitePage === 'rules') initReveal();
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
    // An invite link only pre-fills the lobby. Joining is an explicit choice so a link preview or stray click never seats anyone.
    if (inviteId) { store.online.invite = inviteId; render(); }
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

