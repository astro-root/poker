import { node } from '../ui/dom.ts';
import { SITE_NAME, siteFooter, siteHeader } from '../ui/header.ts';
import { savePlayerName, store } from '../app/state.ts';
import { closeOnlineSession, createOnlineRoom, joinOnlineRoom, refreshOnlineRoom, startOnlineGame } from '../app/online.ts';
import { hooks } from '../app/state.ts';

const online = store.online;

export function renderOnlineLobby(app: HTMLElement): void {
  document.title = `友だちとオンライン対戦 — ${SITE_NAME}`;
  const shell = node('div', 'page-shell');
  shell.append(siteHeader('online'));
  const main = node('main', 'content lobby');

  const intro = node('section', 'content-intro');
  intro.append(node('span', 'eyebrow', 'PRIVATE ROOM'), node('h1', 'page-title', 'リンクを送って、すぐ対戦。'), node('p', 'page-lead', 'ゲスト名を決めて部屋を作り、招待リンクを共有するだけ。手札は本人だけに表示され、配札と進行はサーバーが管理します。'));
  main.append(intro);

  const panel = node('section', 'panel lobby-panel');
  const nameField = node('label', 'field');
  nameField.append(node('span', 'field-label', 'プレイヤー名'));
  const nameInput = node('input', 'text-input');
  nameInput.type = 'text';
  nameInput.value = store.playerName;
  nameInput.maxLength = 40;
  nameInput.setAttribute('autocomplete', 'nickname');
  nameInput.disabled = Boolean(online.roomId);
  nameInput.addEventListener('change', () => {
    savePlayerName(nameInput.value);
    online.names.set(store.humanId, store.playerName);
    hooks.renderLobby();
  });
  nameField.append(nameInput);
  panel.append(nameField);

  if (!online.roomId) {
    const create = node('button', 'button button-primary button-large', '対戦ルームを作る');
    create.type = 'button';
    create.addEventListener('click', () => { void createOnlineRoom(); });
    panel.append(create, node('div', 'divider', 'または招待リンクから参加'));
    const joinRow = node('div', 'inline-row');
    const roomInput = node('input', 'text-input');
    roomInput.placeholder = '招待リンクまたはルームID';
    roomInput.setAttribute('aria-label', '招待リンクまたはルームID');
    const join = node('button', 'button button-secondary', '参加');
    join.type = 'button';
    join.addEventListener('click', () => {
      const match = roomInput.value.match(/(?:#room=)?([a-f0-9]{36})$/u);
      if (match?.[1]) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#room=${match[1]}`);
        void joinOnlineRoom(match[1]);
      } else { online.error = '有効な招待リンクまたはルームIDを入力してください。'; hooks.renderLobby(); }
    });
    joinRow.append(roomInput, join);
    panel.append(joinRow);
  } else {
    const invite = `${window.location.origin}${window.location.pathname}${window.location.search}#room=${online.roomId}`;
    panel.append(node('h2', 'panel-title', online.host ? '友だちを招待' : 'ルームに参加中'));
    const inviteRow = node('div', 'inline-row');
    const inviteInput = node('input', 'text-input');
    inviteInput.value = invite;
    inviteInput.readOnly = true;
    inviteInput.setAttribute('aria-label', '招待リンク');
    const copy = node('button', 'button button-secondary', 'コピー');
    copy.type = 'button';
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(invite).then(() => { online.status = '招待リンクをコピーしました'; hooks.renderLobby(); })
        .catch(() => { inviteInput.select(); online.status = 'リンクを選択しました。コピーしてください'; hooks.renderLobby(); });
    });
    inviteRow.append(inviteInput, copy);
    if (typeof navigator.share === 'function') {
      const share = node('button', 'button button-secondary', '共有');
      share.type = 'button';
      share.addEventListener('click', () => {
        void navigator.share({ title: `${SITE_NAME}に招待`, text: '一緒にポーカーを遊ぼう', url: invite }).catch(() => { /* Closing the share sheet is not an error. */ });
      });
      inviteRow.append(share);
    }
    panel.append(inviteRow);
    const status = node('p', 'status-line', online.status || (online.host ? '友だちの参加を待っています' : 'ホストに接続しています'));
    status.setAttribute('role', 'status');
    panel.append(status);

    const roster = node('ul', 'roster');
    for (const peer of online.peers) {
      const item = node('li', `roster-item${peer.connected ? '' : ' is-away'}`);
      const label = node('strong', 'roster-name', peer.name);
      if (peer.id === store.humanId) label.append(node('span', 'you-badge', 'YOU'));
      item.append(node('span', `presence-dot ${peer.connected ? 'is-on' : ''}`), label);
      item.append(node('span', 'roster-state', peer.connected ? '在席' : '離席'));
      roster.append(item);
    }
    if (!online.peers.length) roster.append(node('li', 'roster-empty', '参加者を確認しています…'));
    panel.append(roster);

    const refresh = node('button', 'button button-ghost', '状態を更新');
    refresh.type = 'button';
    refresh.addEventListener('click', () => { void refreshOnlineRoom(); });

    if (online.started) {
      const back = node('button', 'button button-primary button-large', 'テーブルに戻る');
      back.type = 'button';
      back.addEventListener('click', () => { store.mode = 'online-playing'; hooks.render(); });
      panel.append(back, refresh);
    } else if (online.host) {
      const start = node('button', 'button button-primary button-large', '対戦を開始');
      start.type = 'button';
      start.disabled = online.peers.filter((peer) => peer.connected).length < 2;
      start.addEventListener('click', startOnlineGame);
      panel.append(start, refresh);
      if (start.disabled) panel.append(node('p', 'hint', '2人以上が在席すると開始できます。'));
    } else {
      panel.append(node('p', 'hint', 'ホストが開始すると自動でテーブルに移動します。'), refresh);
    }
  }
  if (online.error) {
    const error = node('p', 'error-line', online.error);
    error.setAttribute('role', 'alert');
    panel.append(error);
  }
  const practice = node('button', 'button button-ghost', online.roomId ? 'ルームを出てAI対戦へ' : 'AI対戦へ');
  practice.type = 'button';
  practice.addEventListener('click', () => { void closeOnlineSession().finally(() => { window.location.assign('/ai'); }); });
  panel.append(practice);
  main.append(panel);
  shell.append(main, siteFooter());
  app.replaceChildren(shell);
}

