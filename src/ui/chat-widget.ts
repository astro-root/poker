import { node } from './dom.ts';
import { hooks, store } from '../app/state.ts';
import { markChatSeen, sendChat } from '../app/online.ts';
import { CHAT_EMOJI } from '../supabase/online-room.ts';

/**
 * Room chat and quick emoji reactions. It lives on document.body, outside the re-rendered app root, so the
 * text being typed and the panel's scroll position survive every poll and game-state render.
 */
const online = store.online;
let root: HTMLElement | null = null;
let list: HTMLUListElement;
let badge: HTMLElement;
let panel: HTMLElement;
let toggle: HTMLButtonElement;
let toasts: HTMLElement;
let input: HTMLInputElement;
let renderedUpTo = 0;
let toastedUpTo = -1;

function build(): HTMLElement {
  const wrap = node('div', 'chat-widget');
  toggle = node('button', 'chat-toggle', '💬');
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'チャットを開く');
  toggle.setAttribute('aria-expanded', 'false');
  badge = node('span', 'chat-badge');
  badge.hidden = true;
  toggle.append(badge);
  toasts = node('div', 'chat-toasts');
  toasts.setAttribute('aria-live', 'polite');

  panel = node('section', 'chat-panel');
  panel.hidden = true;
  panel.setAttribute('aria-label', 'チャット');
  const head = node('div', 'chat-head');
  const close = node('button', 'chat-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'チャットを閉じる');
  head.append(node('strong', '', 'チャット'), close);
  list = node('ul', 'chat-list');
  list.setAttribute('role', 'log');
  const emoji = node('div', 'chat-emoji');
  for (const symbol of CHAT_EMOJI) {
    const b = node('button', 'chat-emoji-button', symbol);
    b.type = 'button';
    b.setAttribute('aria-label', `スタンプ ${symbol}`);
    b.addEventListener('click', () => sendChat('emoji', symbol));
    emoji.append(b);
  }
  const form = node('form', 'chat-form');
  input = node('input', 'text-input chat-input');
  input.type = 'text'; input.maxLength = 80; input.placeholder = 'メッセージ（80文字まで）';
  input.setAttribute('aria-label', 'メッセージ'); input.autocomplete = 'off'; input.enterKeyHint = 'send';
  const send = node('button', 'button button-primary button-small', '送信');
  send.type = 'submit';
  form.append(input, send);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendChat('text', text);
  });
  panel.append(head, list, emoji, form);

  const setOpen = (open: boolean): void => {
    online.chatOpen = open;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) { markChatSeen(); updateChatWidget(); list.scrollTop = list.scrollHeight; input.focus({ preventScroll: true }); }
  };
  toggle.addEventListener('click', () => setOpen(!online.chatOpen));
  close.addEventListener('click', () => { setOpen(false); toggle.focus({ preventScroll: true }); });
  panel.addEventListener('keydown', (event) => { if (event.key === 'Escape') setOpen(false); });
  wrap.append(toasts, panel, toggle);
  return wrap;
}

/** Re-syncs the widget with the online store. Cheap and idempotent; called after every room update. */
export function updateChatWidget(): void {
  const visible = Boolean(online.roomId) && (store.mode === 'online-lobby' || store.mode === 'online-playing');
  if (!visible) { root?.remove(); root = null; renderedUpTo = 0; toastedUpTo = -1; return; }
  if (!root) { root = build(); document.body.append(root); }
  const messages = online.chat;
  const last = messages.at(-1)?.id ?? 0;
  if (toastedUpTo < 0) toastedUpTo = last; // do not pop up history when first joining
  if (last !== renderedUpTo || list.childElementCount !== messages.length) {
    const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.replaceChildren(...messages.map((message) => {
      const item = node('li', `chat-item${message.from === store.humanId ? ' is-me' : ''}${message.kind === 'emoji' ? ' is-emoji' : ''}`);
      const who = node('span', 'chat-name', message.from === store.humanId ? 'あなた' : message.name);
      item.append(who, node('span', 'chat-text', message.text)); // textContent only: never HTML
      return item;
    }));
    if (stick || online.chatOpen) list.scrollTop = list.scrollHeight;
    renderedUpTo = last;
  }
  // Short floating pop-ups for what others just said, so reactions are noticed with the panel closed.
  for (const message of messages) {
    if (message.id <= toastedUpTo) continue;
    toastedUpTo = Math.max(toastedUpTo, message.id);
    if (message.from === store.humanId || online.chatOpen) continue;
    const toast = node('div', `chat-toast${message.kind === 'emoji' ? ' is-emoji' : ''}`);
    toast.append(node('strong', '', message.name), document.createTextNode(` ${message.text}`));
    toasts.append(toast);
    window.setTimeout(() => toast.remove(), 4_000);
    while (toasts.childElementCount > 3) toasts.firstElementChild?.remove();
  }
  const unread = online.chatOpen ? 0 : messages.filter((message) => message.id > online.chatSeen && message.from !== store.humanId).length;
  badge.hidden = unread === 0;
  badge.textContent = unread > 9 ? '9+' : String(unread);
}

hooks.chat = updateChatWidget;
