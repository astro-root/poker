import { node } from '../ui/dom.ts';
import { SITE_NAME, siteFooter, siteHeader } from '../ui/header.ts';
import { savePlayerName, store } from '../app/state.ts';
import { closeOnlineSession, createOnlineRoom, joinOnlineRoom, refreshOnlineRoom, renameSelf, saveRoomSettings, startOnlineGame } from '../app/online.ts';
import { HAND_PRESETS, STACK_PRESETS, type RoomSettings } from '../poker/settings.ts';
import { formatChips } from '../ui/dom.ts';
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
  nameInput.addEventListener('change', () => {
    if (online.roomId) return; // In a room the name is changed through the server with the button below.
    savePlayerName(nameInput.value);
    online.names.set(store.humanId, store.playerName);
    hooks.renderLobby();
  });
  nameField.append(nameInput);
  panel.append(nameField);
  if (online.roomId) {
    const rename = node('button', 'button button-secondary', '名前を変更');
    rename.type = 'button';
    rename.addEventListener('click', () => renameSelf(nameInput.value));
    panel.append(rename);
  }

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
    if (online.spectateOffer) {
      const watch = node('button', 'button button-secondary', 'この対戦を観戦する');
      watch.type = 'button';
      watch.addEventListener('click', () => { const id = online.spectateOffer; online.error = ''; online.spectateOffer = ''; void joinOnlineRoom(id, true); });
      panel.append(watch, node('p', 'hint', '観戦者は手札を見ることも、操作することもできません。'));
    }
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
    const watching = online.spectators.filter((peer) => peer.connected);
    if (watching.length || online.role === 'spectator') {
      panel.append(node('p', 'hint', `観戦中 ${watching.length}人${online.role === 'spectator' ? '（あなたは観戦者です）' : ''}`));
    }
    if (online.role === 'player') panel.append(renderSettings());

    const refresh = node('button', 'button button-ghost', '状態を更新');
    refresh.type = 'button';
    refresh.addEventListener('click', () => { void refreshOnlineRoom(); });

    if (online.started) {
      const back = node('button', 'button button-primary button-large', 'テーブルに戻る');
      back.type = 'button';
      back.addEventListener('click', () => { store.mode = 'online-playing'; hooks.render(); });
      panel.append(back, refresh);
    } else if (online.role === 'spectator') {
      panel.append(node('p', 'hint', '観戦中です。対戦が始まると自動でテーブルが表示されます。'), refresh);
    } else if (online.host) {
      const start = node('button', 'button button-primary button-large', '対戦を開始');
      start.type = 'button';
      start.disabled = online.pending || Boolean(online.settingsDraft) || online.peers.filter((peer) => peer.connected).length < 2;
      start.addEventListener('click', startOnlineGame);
      panel.append(start, refresh);
      if (start.disabled) panel.append(node('p', 'hint', online.settingsDraft ? '設定を保存してから開始してください。' : '2人以上が在席すると開始できます。'));
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


function summary(settings: RoomSettings): string {
  const hands = settings.maxHands === null ? '無制限' : `${settings.maxHands}ハンド`;
  const ante = settings.ante > 0 ? ` · アンティ ${formatChips(settings.ante)}` : '';
  return `初期スタック ${formatChips(settings.startingStack)} · ブラインド ${formatChips(settings.smallBlind)}/${formatChips(settings.bigBlind)}${ante} · ${hands}${settings.escalateBlinds ? ' · 10ハンドごとにブラインド2倍' : ' · ブラインド固定'}`;
}

function numberField(label: string, value: number, onInput: (value: number) => void, disabled: boolean, min = 0): HTMLLabelElement {
  const field = node('label', 'field');
  field.append(node('span', 'field-label', label));
  const input = node('input', 'text-input');
  input.type = 'number'; input.inputMode = 'numeric'; input.min = String(min); input.step = '1'; input.value = String(value); input.disabled = disabled;
  input.addEventListener('input', () => onInput(input.value.trim() === '' ? Number.NaN : Number(input.value)));
  field.append(input);
  return field;
}

/** Host sees editable settings while the room is waiting; everyone else sees the same values read-only. */
function renderSettings(): HTMLElement {
  const box = node('section', 'settings-box');
  box.append(node('h2', 'panel-title', 'ゲーム設定'));
  if (!online.host || online.started) {
    box.append(node('p', 'hint settings-summary', summary(online.settings)));
    if (!online.host) box.append(node('p', 'hint', '設定を変更できるのはホストだけです。'));
    return box;
  }
  const current: RoomSettings = online.settingsDraft ?? online.settings;
  let saveButton: HTMLButtonElement | undefined;
  const edit = (patch: Partial<RoomSettings>): void => { online.settingsDraft = { ...current, ...patch }; if (saveButton) saveButton.disabled = false; };
  const locked = online.pending;
  const stack = node('div', 'field');
  stack.append(node('span', 'field-label', '初期スタック'));
  const presets = node('div', 'preset-row');
  for (const value of STACK_PRESETS) {
    const b = node('button', `chip-option${current.startingStack === value ? ' is-selected' : ''}`, formatChips(value));
    b.type = 'button'; b.disabled = locked; b.setAttribute('aria-pressed', String(current.startingStack === value));
    b.addEventListener('click', () => { edit({ startingStack: value }); hooks.renderLobby(); });
    presets.append(b);
  }
  stack.append(presets);
  box.append(stack, numberField('初期スタック（任意の値）', current.startingStack, (v) => edit({ startingStack: v }), locked, 100));
  const hands = node('div', 'field');
  hands.append(node('span', 'field-label', 'ハンド数'));
  const handRow = node('div', 'preset-row');
  for (const value of [...HAND_PRESETS, null] as const) {
    const b = node('button', `chip-option${current.maxHands === value ? ' is-selected' : ''}`, value === null ? '無制限' : String(value));
    b.type = 'button'; b.disabled = locked; b.setAttribute('aria-pressed', String(current.maxHands === value));
    b.addEventListener('click', () => { edit({ maxHands: value }); hooks.renderLobby(); });
    handRow.append(b);
  }
  hands.append(handRow);
  box.append(hands);
  const grid = node('div', 'settings-grid');
  grid.append(
    numberField('スモールブラインド', current.smallBlind, (v) => edit({ smallBlind: v }), locked, 1),
    numberField('ビッグブラインド', current.bigBlind, (v) => edit({ bigBlind: v }), locked, 2),
    numberField('アンティ（0で無し）', current.ante, (v) => edit({ ante: v }), locked, 0),
  );
  box.append(grid);
  const esc = node('label', 'check-row');
  const box2 = node('input'); box2.type = 'checkbox'; box2.checked = current.escalateBlinds; box2.disabled = locked;
  box2.addEventListener('change', () => edit({ escalateBlinds: box2.checked }));
  esc.append(box2, node('span', '', '10ハンドごとにブラインドとアンティを2倍にする'));
  box.append(esc);
  const save = node('button', 'button button-secondary', '設定を保存');
  save.type = 'button'; save.disabled = locked || !online.settingsDraft;
  save.addEventListener('click', () => { if (online.settingsDraft) saveRoomSettings(online.settingsDraft); });
  saveButton = save;
  box.append(save, node('p', 'hint settings-summary', `現在の設定: ${summary(online.settings)}`));
  return box;
}
