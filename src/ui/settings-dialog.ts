import { node, formatChips } from './dom.ts';
import { HAND_PRESETS, STACK_PRESETS, parseSettings, type RoomSettings } from '../poker/settings.ts';

export type SettingsDialogOptions = Readonly<{
  title: string;
  submitLabel: string;
  initial: RoomSettings;
  /** The starting stack cannot change once a game has begun. */
  lockStartingStack?: boolean;
  /** Short note shown under the title (for example "applies from the next hand"). */
  note?: string;
  /** Return an error message to keep the dialog open, or null to close it. */
  onSubmit: (settings: RoomSettings) => Promise<string | null>;
}>;

let openDialog: HTMLDialogElement | null = null;

/**
 * Host settings as a modal <dialog>. It lives on document.body, outside the re-rendered app root, so
 * polling and game-state renders never wipe what the host is typing.
 */
export function openSettingsDialog(options: SettingsDialogOptions): void {
  openDialog?.close();
  const dialog = document.createElement('dialog');
  dialog.className = 'modal settings-modal';
  dialog.setAttribute('aria-labelledby', 'settings-title');
  let draft: RoomSettings = { ...options.initial };
  const form = node('form', 'modal-form');
  form.noValidate = true;
  const heading = node('h2', 'modal-title', options.title);
  heading.id = 'settings-title';
  const body = node('div', 'modal-body');
  const error = node('p', 'form-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;

  const refreshSelected = (): void => {
    for (const button of body.querySelectorAll<HTMLButtonElement>('[data-group]')) {
      const selected = button.dataset.group === 'stack' ? String(draft.startingStack) === button.dataset.value
        : String(draft.maxHands ?? 'null') === button.dataset.value;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  };
  const numberField = (label: string, key: 'startingStack' | 'smallBlind' | 'bigBlind' | 'ante', min: number, disabled = false): HTMLElement => {
    const field = node('label', 'field');
    field.append(node('span', 'field-label', label));
    const input = node('input', 'text-input');
    input.type = 'number'; input.inputMode = 'numeric'; input.min = String(min); input.step = '1'; input.disabled = disabled;
    input.value = String(draft[key]);
    input.addEventListener('input', () => { draft = { ...draft, [key]: input.value.trim() === '' ? Number.NaN : Number(input.value) }; refreshSelected(); });
    field.append(input);
    return field;
  };
  const presets = (group: 'stack' | 'hands', label: string, values: readonly (number | null)[], disabled: boolean): HTMLElement => {
    const wrap = node('div', 'field');
    wrap.append(node('span', 'field-label', label));
    const row = node('div', 'preset-row');
    for (const value of values) {
      const b = node('button', 'chip-option', value === null ? '無制限' : group === 'stack' ? formatChips(value) : `${value}`);
      b.type = 'button'; b.disabled = disabled; b.dataset.group = group; b.dataset.value = String(value);
      b.addEventListener('click', () => {
        draft = group === 'stack' ? { ...draft, startingStack: value as number } : { ...draft, maxHands: value };
        const input = group === 'stack' ? body.querySelector<HTMLInputElement>('input[data-key="startingStack"]') : null;
        if (input) input.value = String(draft.startingStack);
        refreshSelected();
      });
      row.append(b);
    }
    wrap.append(row);
    return wrap;
  };

  const lock = options.lockStartingStack === true;
  const stackInput = numberField('初期スタック（任意の値）', 'startingStack', 100, lock);
  stackInput.querySelector('input')!.dataset.key = 'startingStack';
  body.append(presets('stack', '初期スタック', STACK_PRESETS, lock), stackInput, presets('hands', 'ハンド数', [...HAND_PRESETS, null], false));
  const grid = node('div', 'settings-grid');
  grid.append(numberField('スモールブラインド', 'smallBlind', 1), numberField('ビッグブラインド', 'bigBlind', 2), numberField('アンティ（0で無し）', 'ante', 0));
  body.append(grid);
  const check = (label: string, key: 'escalateBlinds' | 'showHandRank'): HTMLElement => {
    const row = node('label', 'check-row');
    const box = node('input'); box.type = 'checkbox'; box.checked = draft[key];
    box.addEventListener('change', () => { draft = { ...draft, [key]: box.checked }; });
    row.append(box, node('span', '', label));
    return row;
  };
  body.append(check('10ハンドごとにブラインドとアンティを2倍にする', 'escalateBlinds'), check('プレイヤーに自分の現在の役を表示する', 'showHandRank'));

  const footer = node('div', 'modal-actions');
  const cancel = node('button', 'button button-secondary', 'キャンセル');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const submit = node('button', 'button button-primary', options.submitLabel);
  submit.type = 'submit';
  footer.append(cancel, submit);
  form.append(heading);
  if (options.note) form.append(node('p', 'hint', options.note));
  form.append(body, error, footer);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const checked = parseSettings(draft);
    if (!checked.ok) { error.textContent = checked.error; error.hidden = false; return; }
    submit.disabled = true; error.hidden = true;
    void options.onSubmit(checked.settings).then((message) => {
      if (message === null) { dialog.close(); return; }
      error.textContent = message; error.hidden = false; submit.disabled = false;
    });
  });
  dialog.append(form);
  dialog.addEventListener('close', () => { dialog.remove(); if (openDialog === dialog) openDialog = null; });
  // Clicking the dimmed backdrop (the dialog element itself) dismisses it.
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  document.body.append(dialog);
  openDialog = dialog;
  refreshSelected();
  dialog.showModal();
}
