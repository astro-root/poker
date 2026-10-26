import { formatChips, node } from '../ui/dom.ts';
import { SITE_NAME, siteFooter, siteHeader } from '../ui/header.ts';
import { hooks, savePlayerName, store } from '../app/state.ts';
import {
  closeOnlineSession, createOnlineRoom, joinOnlineRoom, joinOnlineRoomByCode, kickPlayer, refreshOnlineRoom, renameSelf, saveRoomSettings, startOnlineGame,
} from '../app/online.ts';
import { DEFAULT_SETTINGS, type RoomSettings } from '../poker/settings.ts';
import { openSettingsDialog } from '../ui/settings-dialog.ts';

const online = store.online;

export function settingsSummary(settings: RoomSettings): string {
  const hands = settings.maxHands === null ? '無制限' : `${settings.maxHands}ハンド`;
  const ante = settings.ante > 0 ? ` · アンティ ${formatChips(settings.ante)}` : '';
  return `初期スタック ${formatChips(settings.startingStack)} · ブラインド ${formatChips(settings.smallBlind)}/${formatChips(settings.bigBlind)}${ante} · ${hands}`
    + `${settings.escalateBlinds ? ' · 10ハンドごとにブラインド2倍' : ' · ブラインド固定'}${settings.showHandRank ? '' : ' · 役の表示なし'}`;
}

/** Host settings dialog, usable in the lobby and during a game (changes apply from the next hand). */
export function openHostSettings(): void {
  const started = online.started;
  openSettingsDialog({
    title: 'ルーム設定',
    submitLabel: '設定を保存',
    initial: online.settings,
    lockStartingStack: started,
    note: started ? '対戦中の変更は、次のハンドから反映されます。初期スタックは変更できません。' : undefined,
    onSubmit: saveRoomSettings,
  });
}

function copyButton(text: string, label: string, done: string): HTMLButtonElement {
  const button = node('button', 'button button-secondary', label);
  button.type = 'button';
  button.addEventListener('click', () => {
    void navigator.clipboard?.writeText(text).then(() => { online.status = done; hooks.renderLobby(); })
      .catch(() => { online.status = '手動でコピーしてください'; hooks.renderLobby(); });
  });
  return button;
}

function renderRoster(panel: HTMLElement): void {
  const roster = node('ul', 'roster');
  const row = (peer: { id: string; name: string; connected: boolean }, spectator: boolean): HTMLElement => {
    const item = node('li', `roster-item${peer.connected ? '' : ' is-away'}`);
    const label = node('strong', 'roster-name', peer.name);
    if (peer.id === store.humanId) label.append(node('span', 'you-badge', 'YOU'));
    if (peer.id === online.hostId) label.append(node('span', 'you-badge host-badge', 'HOST'));
    item.append(node('span', `presence-dot ${peer.connected ? 'is-on' : ''}`), label,
      node('span', 'roster-state', spectator ? '観戦' : peer.connected ? '在席' : '離席'));
    if (online.host && peer.id !== store.humanId) {
      const kick = node('button', 'button button-ghost button-small kick-button', '退場');
      kick.type = 'button';
      kick.setAttribute('aria-label', `${peer.name}を退場させる`);
      kick.addEventListener('click', () => {
        if (window.confirm(`${peer.name}を退場させますか？\n退場した人は、このルームに戻れません。`)) kickPlayer(peer.id);
      });
      item.append(kick);
    }
    return item;
  };
  for (const peer of online.peers) roster.append(row(peer, false));
  for (const peer of online.spectators.filter((candidate) => candidate.connected)) roster.append(row(peer, true));
  if (!online.peers.length) roster.append(node('li', 'roster-empty', '参加者を確認しています…'));
  panel.append(roster);
}

export function renderOnlineLobby(app: HTMLElement): void {
  document.title = `友だちとオンライン対戦 — ${SITE_NAME}`;
  const shell = node('div', 'page-shell');
  shell.append(siteHeader('online'));
  const main = node('main', 'content lobby');

  const intro = node('section', 'content-intro');
  intro.append(node('span', 'eyebrow', 'PRIVATE ROOM'), node('h1', 'page-title', 'リンクを送って、すぐ対戦。'),
    node('p', 'page-lead', 'ゲスト名を決めて部屋を作り、招待リンクかルームコードを共有するだけ。手札は本人だけに表示され、配札と進行はサーバーが管理します。'));
  main.append(intro);

  const panel = node('section', 'panel lobby-panel');
  const nameField = node('label', 'field');
  nameField.append(node('span', 'field-label', 'プレイヤー名'));
  const nameRow = node('div', 'inline-row');
  const nameInput = node('input', 'text-input');
  nameInput.type = 'text';
  nameInput.value = store.playerName;
  nameInput.maxLength = 40;
  nameInput.setAttribute('autocomplete', 'nickname');
  nameInput.addEventListener('change', () => {
    if (online.roomId) return;
    savePlayerName(nameInput.value);
    online.names.set(store.humanId, store.playerName);
  });
  nameRow.append(nameInput);
  if (online.roomId) {
    const rename = node('button', 'button button-secondary', '変更');
    rename.type = 'button';
    rename.addEventListener('click', () => renameSelf(nameInput.value));
    nameRow.append(rename);
  }
  nameField.append(nameRow);
  panel.append(nameField);

  if (!online.roomId) {
    if (online.invite) {
      const card = node('div', 'invite-card');
      card.append(node('h2', 'panel-title', '招待されています'), node('p', 'hint', 'プレイヤー名を確認して、参加方法を選んでください。名前は参加後も変更できます。'));
      const actions = node('div', 'invite-actions');
      const join = node('button', 'button button-primary button-large', 'このルームに参加する');
      join.type = 'button';
      join.addEventListener('click', () => { savePlayerName(nameInput.value); void joinOnlineRoom(online.invite); });
      const watch = node('button', 'button button-secondary', '観戦する');
      watch.type = 'button';
      watch.addEventListener('click', () => { savePlayerName(nameInput.value); void joinOnlineRoom(online.invite, true); });
      actions.append(join, watch);
      card.append(actions);
      panel.append(card, node('div', 'divider', 'または'));
    }
    const create = node('button', `button ${online.invite ? 'button-secondary' : 'button-primary button-large'}`, '設定してルームを作る');
    create.type = 'button';
    create.addEventListener('click', () => {
      savePlayerName(nameInput.value);
      openSettingsDialog({ title: 'ルームを作成', submitLabel: 'ルームを作る', initial: DEFAULT_SETTINGS, onSubmit: async (settings) => { await createOnlineRoom(settings); return null; } });
    });
    const quick = node('button', 'button button-ghost', '標準設定ですぐ作る');
    quick.type = 'button';
    quick.addEventListener('click', () => { savePlayerName(nameInput.value); void createOnlineRoom(); });
    panel.append(create, quick, node('div', 'divider', '招待リンクまたはルームコードで参加'));
    const joinRow = node('div', 'inline-row');
    const roomInput = node('input', 'text-input');
    roomInput.placeholder = '招待リンク / ルームコード（例: K7M2QX）';
    roomInput.setAttribute('aria-label', '招待リンクまたはルームコード');
    roomInput.autocapitalize = 'characters';
    roomInput.autocomplete = 'off';
    const join = node('button', 'button button-secondary', '参加');
    join.type = 'button';
    join.addEventListener('click', () => {
      savePlayerName(nameInput.value);
      const value = roomInput.value.trim();
      if (!value) { online.error = '招待リンクまたはルームコードを入力してください。'; hooks.renderLobby(); return; }
      const link = value.match(/([a-f0-9]{36})\s*$/iu);
      if (link?.[1]) void joinOnlineRoom(link[1].toLowerCase());
      else joinOnlineRoomByCode(value);
    });
    roomInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') join.click(); });
    joinRow.append(roomInput, join);
    panel.append(joinRow);
    if (online.spectateOffer) {
      const watch = node('button', 'button button-secondary', 'この対戦を観戦する');
      watch.type = 'button';
      watch.addEventListener('click', () => { const id = online.spectateOffer; online.error = ''; online.spectateOffer = ''; void joinOnlineRoom(id, true); });
      panel.append(watch, node('p', 'hint', '観戦者は手札を見ることも、操作することもできません。'));
    }
  } else {
    const invite = `${window.location.origin}${window.location.pathname}${window.location.search}#room=${online.roomId}`;
    panel.append(node('h2', 'panel-title', online.host ? '友だちを招待' : 'ルームに参加中'));
    if (online.code) {
      const codeBox = node('div', 'room-code');
      codeBox.append(node('span', 'field-label', 'ルームコード'), node('strong', 'room-code-value', online.code), copyButton(online.code, 'コピー', 'ルームコードをコピーしました'));
      panel.append(codeBox);
    }
    const inviteRow = node('div', 'inline-row');
    const inviteInput = node('input', 'text-input');
    inviteInput.value = invite;
    inviteInput.readOnly = true;
    inviteInput.setAttribute('aria-label', '招待リンク');
    inviteRow.append(inviteInput, copyButton(invite, 'リンクをコピー', '招待リンクをコピーしました'));
    if (typeof navigator.share === 'function') {
      const share = node('button', 'button button-secondary', '共有');
      share.type = 'button';
      share.addEventListener('click', () => { void navigator.share({ title: `${SITE_NAME}に招待`, text: '一緒にポーカーを遊ぼう', url: invite }).catch(() => { /* Closing the share sheet is not an error. */ }); });
      inviteRow.append(share);
    }
    panel.append(inviteRow);
    const status = node('p', 'status-line', online.status || (online.host ? '友だちの参加を待っています' : 'ホストに接続しています'));
    status.setAttribute('role', 'status');
    panel.append(status);
    renderRoster(panel);
    if (online.role === 'spectator') panel.append(node('p', 'hint', 'あなたは観戦者です。'));

    const settingsBox = node('section', 'settings-box');
    settingsBox.append(node('h2', 'panel-title', 'ゲーム設定'), node('p', 'hint settings-summary', settingsSummary(online.settings)));
    if (online.host) {
      const edit = node('button', 'button button-secondary', '設定を変更');
      edit.type = 'button';
      edit.addEventListener('click', openHostSettings);
      settingsBox.append(edit);
    } else settingsBox.append(node('p', 'hint', '設定を変更できるのはホストだけです。'));
    panel.append(settingsBox);

    const refresh = node('button', 'button button-ghost', '状態を更新');
    refresh.type = 'button';
    refresh.addEventListener('click', () => { void refreshOnlineRoom(); });
    if (online.started) {
      const back = node('button', 'button button-primary button-large', 'テーブルに戻る');
      back.type = 'button';
      back.addEventListener('click', () => { store.mode = 'online-playing'; hooks.render(); });
      panel.append(back, refresh);
    } else if (online.role === 'spectator') {
      panel.append(node('p', 'hint', '対戦が始まると自動でテーブルが表示されます。'), refresh);
    } else if (online.host) {
      const start = node('button', 'button button-primary button-large', '対戦を開始');
      start.type = 'button';
      start.disabled = online.pending || online.peers.filter((peer) => peer.connected).length < 2;
      start.addEventListener('click', startOnlineGame);
      panel.append(start, refresh);
      if (start.disabled) panel.append(node('p', 'hint', '2人以上が在席すると開始できます。'));
    } else panel.append(node('p', 'hint', 'ホストが開始すると自動でテーブルに移動します。'), refresh);
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
