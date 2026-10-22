import { AI_LEVELS, AI_LEVEL_DESCRIPTIONS, AI_LEVEL_LABELS, type AiLevel } from '../poker/ai.ts';
import { node } from '../ui/dom.ts';
import { SITE_NAME, siteFooter, siteHeader } from '../ui/header.ts';
import { MAX_AI, MIN_AI, AI_ROSTER, saveAiSettings, savePlayerName, store } from '../app/state.ts';
import { startPractice } from '../app/practice.ts';

/** AI setup: choose opponent strength (4 tiers) and head-count (1–7). Selections are remembered on this device. */
export function renderPracticeSetup(app: HTMLElement): void {
  document.title = `AI対戦の設定 — ${SITE_NAME}`;
  const shell = node('div', 'page-shell');
  shell.append(siteHeader('ai'));
  const main = node('main', 'content setup');

  const intro = node('section', 'content-intro');
  intro.append(node('span', 'eyebrow', 'SOLO MATCH'), node('h1', 'page-title', 'AI対戦の設定'), node('p', 'page-lead', '対戦相手の強さと人数を選んで、闘技場に入ります。選んだ内容はこの端末に保存されます。'));
  main.append(intro);

  let level: AiLevel = store.ai.level;
  let count = store.ai.count;

  const form = node('div', 'setup-form');

  // 01 — strength
  const strength = node('section', 'setup-block');
  strength.append(node('span', 'setup-step', '01'), node('h2', 'setup-title', '対戦相手の強さ'));
  const levelGroup = node('div', 'level-options');
  levelGroup.setAttribute('role', 'radiogroup');
  levelGroup.setAttribute('aria-label', '対戦相手の強さ');
  const levelButtons: HTMLButtonElement[] = [];
  AI_LEVELS.forEach((value, index) => {
    const option = node('button', 'level-option');
    option.type = 'button';
    option.setAttribute('role', 'radio');
    option.dataset.level = value;
    const pips = node('span', 'level-pips');
    pips.setAttribute('aria-hidden', 'true');
    for (let pip = 0; pip < 4; pip++) pips.append(node('i', pip <= index ? 'is-on' : ''));
    option.append(pips, node('strong', 'level-name', AI_LEVEL_LABELS[value]), node('span', 'level-desc', AI_LEVEL_DESCRIPTIONS[value]));
    option.addEventListener('click', () => { level = value; sync(); });
    levelButtons.push(option);
    levelGroup.append(option);
  });
  strength.append(levelGroup);

  // 02 — headcount
  const people = node('section', 'setup-block');
  people.append(node('span', 'setup-step', '02'), node('h2', 'setup-title', 'AIの人数'));
  const countGroup = node('div', 'count-options');
  countGroup.setAttribute('role', 'radiogroup');
  countGroup.setAttribute('aria-label', 'AIの人数');
  const countButtons: HTMLButtonElement[] = [];
  for (let value = MIN_AI; value <= MAX_AI; value++) {
    const option = node('button', 'count-option', String(value));
    option.type = 'button';
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-label', `AI ${value}人`);
    option.addEventListener('click', () => { count = value; sync(); });
    countButtons.push(option);
    countGroup.append(option);
  }
  const preview = node('div', 'table-preview');
  preview.setAttribute('aria-live', 'polite');
  const previewSeats = node('div', 'preview-seats');
  const previewText = node('p', 'preview-text');
  preview.append(previewSeats, previewText);
  people.append(countGroup, preview);

  // 03 — name
  const identity = node('section', 'setup-block');
  identity.append(node('span', 'setup-step', '03'), node('h2', 'setup-title', 'プレイヤー名'));
  const nameField = node('label', 'field');
  nameField.append(node('span', 'field-label', '卓に表示される名前（20文字まで）'));
  const nameInput = node('input', 'text-input');
  nameInput.type = 'text';
  nameInput.value = store.playerName;
  nameInput.maxLength = 40;
  nameInput.setAttribute('autocomplete', 'nickname');
  nameInput.addEventListener('change', () => { savePlayerName(nameInput.value); nameInput.value = store.playerName; });
  nameField.append(nameInput);
  identity.append(nameField);

  const start = node('button', 'button button-primary button-large setup-start', 'ゲーム開始');
  start.type = 'button';
  start.addEventListener('click', () => {
    savePlayerName(nameInput.value);
    saveAiSettings({ level, count });
    startPractice();
  });

  const arrowKeys = (group: HTMLElement, buttons: HTMLButtonElement[]): void => {
    group.addEventListener('keydown', (event) => {
      const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
      const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
      if (!forward && !backward) return;
      event.preventDefault();
      const current = buttons.findIndex((button) => button.classList.contains('is-selected'));
      const next = buttons[(current + (forward ? 1 : -1) + buttons.length) % buttons.length]!;
      next.click();
      next.focus();
    });
  };
  arrowKeys(levelGroup, levelButtons);
  arrowKeys(countGroup, countButtons);

  function sync(): void {
    levelButtons.forEach((button) => {
      const selected = button.dataset.level === level;
      button.setAttribute('aria-checked', String(selected));
      button.classList.toggle('is-selected', selected);
      button.tabIndex = selected ? 0 : -1;
    });
    countButtons.forEach((button, index) => {
      const selected = index + 1 === count;
      button.setAttribute('aria-checked', String(selected));
      button.classList.toggle('is-selected', selected);
      button.tabIndex = selected ? 0 : -1;
    });
    previewSeats.replaceChildren(node('span', 'preview-seat is-you', 'YOU'));
    for (let index = 0; index < count; index++) previewSeats.append(node('span', 'preview-seat', Array.from(AI_ROSTER[index]!.name)[0]!));
    previewText.textContent = `あなた＋AI ${count}人（${AI_LEVEL_LABELS[level]}）の${count + 1}人卓 · 全員 1,000 チップから開始`;
  }
  sync();

  form.append(strength, people, identity, start);
  main.append(form);
  shell.append(main, siteFooter());
  app.replaceChildren(shell);
}
