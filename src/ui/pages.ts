import type { Card } from '../poker/cards.ts';
import { HAND_NAMES, type HandCategory } from '../poker/evaluator.ts';
import { POKER_GLOSSARY } from '../poker/education.ts';
import { AI_LEVELS, AI_LEVEL_DESCRIPTIONS, AI_LEVEL_LABELS } from '../poker/ai.ts';
import { node } from './dom.ts';
import { cardElement } from './components/card.ts';
import { SITE_NAME, SITE_TAGLINE, SITE_TITLE, pageLink, siteFooter, siteHeader, type SitePage } from './header.ts';

export type { SitePage } from './header.ts';

function setMeta(title: string): void {
  document.title = title;
}

function arrow(): HTMLElement {
  const el = node('span', 'row-arrow', '→');
  el.setAttribute('aria-hidden', 'true');
  return el;
}

export function renderHomePage(app: HTMLElement, sitePage: SitePage): void {
  setMeta(SITE_TITLE);
  const shell = node('div', 'page-shell');
  shell.append(siteHeader(sitePage));
  const main = node('main', 'landing');

  const hero = node('section', 'hero');
  const copy = node('div', 'hero-copy');
  copy.append(node('span', 'eyebrow', 'TEXAS HOLD’EM ARENA'));
  copy.append(node('h1', 'hero-title', SITE_NAME));
  copy.append(node('p', 'hero-tagline', SITE_TAGLINE));
  copy.append(node('p', 'hero-lead', '強さの違う最大7人のAIと腕試し。友だちとはリンクを送るだけ。ルールを学びながら遊べるテキサスホールデムです。'));
  const actions = node('div', 'hero-actions');
  const primary = pageLink('AIと対戦する', '/ai');
  primary.className = 'button button-primary';
  const secondary = pageLink('友だちと対戦する', '/online');
  secondary.className = 'button button-secondary';
  actions.append(primary, secondary);
  copy.append(actions);

  const art = node('div', 'hero-art');
  art.setAttribute('aria-hidden', 'true');
  const arena = node('div', 'arena');
  const cards = node('div', 'arena-cards');
  for (const card of [{ rank: 14, suit: 'spades' }, { rank: 14, suit: 'hearts' }, { rank: 13, suit: 'spades' }, { rank: 12, suit: 'spades' }, { rank: 11, suit: 'spades' }] as const) cards.append(cardElement(card, false, 'md'));
  const pot = node('div', 'arena-pot');
  pot.append(node('span', 'arena-pot-label', 'POT'), node('strong', '', '12,500'));
  const chips = node('div', 'arena-chips');
  chips.append(node('i'), node('i'), node('i'), node('i'));
  arena.append(cards, pot, chips);
  art.append(arena);
  hero.append(copy, art);
  main.append(hero);

  const modes = node('section', 'section');
  modes.append(node('span', 'eyebrow', 'MODES'), node('h2', 'section-title', '遊び方を選ぶ'));
  const list = node('div', 'mode-list');
  const items = [
    { href: '/ai', title: 'AI対戦', body: `強さは「${AI_LEVELS.map((level) => AI_LEVEL_LABELS[level]).join('・')}」の4段階。AIは1〜7人から選べます。`, tag: 'SOLO' },
    { href: '/online', title: 'オンライン対戦', body: '部屋を作って招待リンクを共有。最大6人で、手札は本人にだけ表示されます。', tag: 'FRIENDS' },
    { href: '/glossary', title: 'ポーカー用語集', body: `ブラインドやサイドポットなど、${POKER_GLOSSARY.length}の用語を短い例つきで確認。`, tag: 'LEARN' },
    { href: '/hands', title: '役の強さ一覧', body: 'ロイヤルフラッシュからハイカードまで、10種類の役をカードで見比べます。', tag: 'LEARN' },
  ];
  items.forEach((item, index) => {
    const row = node('a', 'mode-row') as HTMLAnchorElement;
    row.href = item.href;
    const text = node('span', 'mode-text');
    text.append(node('strong', 'mode-title', item.title), node('span', 'mode-body', item.body));
    row.append(node('span', 'mode-number', String(index + 1).padStart(2, '0')), text, node('span', 'mode-tag', item.tag), arrow());
    list.append(row);
  });
  modes.append(list);
  main.append(modes);

  const levels = node('section', 'section');
  levels.append(node('span', 'eyebrow', 'OPPONENTS'), node('h2', 'section-title', '4つの強さ、1〜7人の対戦相手'));
  const grid = node('div', 'level-grid');
  AI_LEVELS.forEach((level, index) => {
    const card = node('div', 'level-card');
    const pips = node('span', 'level-pips');
    pips.setAttribute('aria-hidden', 'true');
    for (let pip = 0; pip < 4; pip++) pips.append(node('i', pip <= index ? 'is-on' : ''));
    card.append(pips, node('strong', '', AI_LEVEL_LABELS[level]), node('p', '', AI_LEVEL_DESCRIPTIONS[level]));
    grid.append(card);
  });
  levels.append(grid);
  main.append(levels);

  shell.append(main, siteFooter());
  app.replaceChildren(shell);
}

function contentIntro(eyebrow: string, title: string, body: string): HTMLElement {
  const intro = node('section', 'content-intro');
  intro.append(node('span', 'eyebrow', eyebrow), node('h1', 'page-title', title), node('p', 'page-lead', body));
  return intro;
}

function bottomNav(...links: HTMLAnchorElement[]): HTMLElement {
  const nav = node('nav', 'content-bottom-nav');
  nav.setAttribute('aria-label', '次のページ');
  for (const link of links) nav.append(link);
  return nav;
}

export function renderGlossaryPage(app: HTMLElement, sitePage: SitePage): void {
  setMeta(`ポーカー用語集 — ${SITE_NAME}`);
  const shell = node('div', 'page-shell');
  shell.append(siteHeader(sitePage));
  const main = node('main', 'content');
  main.append(contentIntro('POKER GLOSSARY', 'ポーカー用語集', 'テキサスホールデムでよく使う言葉を、短い説明と例でまとめました。'));
  const list = node('div', 'term-list');
  for (const [index, entry] of POKER_GLOSSARY.entries()) {
    const article = node('article', 'term-card');
    article.append(node('span', 'term-index', String(index + 1).padStart(2, '0')), node('h2', '', entry.term));
    article.append(node('p', '', entry.explanation), node('p', 'term-example', entry.example));
    list.append(article);
  }
  main.append(list, bottomNav(pageLink('ホームへ戻る', '/'), pageLink('役一覧を見る →', '/hands'), pageLink('AIと対戦する →', '/ai')));
  shell.append(main, siteFooter());
  app.replaceChildren(shell);
}

export function renderHandsPage(app: HTMLElement, sitePage: SitePage): void {
  setMeta(`ポーカーの役一覧 — ${SITE_NAME}`);
  const shell = node('div', 'page-shell');
  shell.append(siteHeader(sitePage));
  const main = node('main', 'content');
  main.append(contentIntro('HAND RANKINGS', '役の強さ一覧', 'テキサスホールデムでは、手札2枚と共通カードから最も強い5枚を選びます。上から順に強い役です。'));

  const sample = (rank: number, suit: Card['suit']): Card => ({ rank: rank as Card['rank'], suit });
  const examples: Readonly<Record<number, Readonly<{ description: string; cards: readonly Card[] }>>> = {
    9: { description: '同じスートの10・J・Q・K・A。作れる中で最も強いストレートフラッシュです。', cards: [sample(10, 'spades'), sample(11, 'spades'), sample(12, 'spades'), sample(13, 'spades'), sample(14, 'spades')] },
    8: { description: '同じスートで数字が5つ連続した役です。A-2-3-4-5が最も低い形です。', cards: [sample(5, 'clubs'), sample(6, 'clubs'), sample(7, 'clubs'), sample(8, 'clubs'), sample(9, 'clubs')] },
    7: { description: '同じ数字が4枚。残りの1枚が異なる場合は、そのカードで勝敗を比べます。', cards: [sample(13, 'clubs'), sample(13, 'diamonds'), sample(13, 'hearts'), sample(13, 'spades'), sample(2, 'clubs')] },
    6: { description: '同じ数字3枚と、別の同じ数字2枚の組み合わせです。', cards: [sample(12, 'clubs'), sample(12, 'diamonds'), sample(12, 'hearts'), sample(8, 'spades'), sample(8, 'hearts')] },
    5: { description: '5枚すべてが同じスート。数字の高いカードから比べます。', cards: [sample(14, 'hearts'), sample(11, 'hearts'), sample(8, 'hearts'), sample(4, 'hearts'), sample(2, 'hearts')] },
    4: { description: 'スートに関係なく、数字が5つ連続した役です。Aは最小の1としても使えます。', cards: [sample(5, 'clubs'), sample(6, 'diamonds'), sample(7, 'hearts'), sample(8, 'spades'), sample(9, 'clubs')] },
    3: { description: '同じ数字が3枚。残り2枚の高さを順に比べます。', cards: [sample(7, 'clubs'), sample(7, 'diamonds'), sample(7, 'hearts'), sample(14, 'clubs'), sample(13, 'diamonds')] },
    2: { description: '異なる数字のペアが2組。高いペア、低いペア、最後の1枚の順で比べます。', cards: [sample(12, 'clubs'), sample(12, 'diamonds'), sample(4, 'hearts'), sample(4, 'spades'), sample(14, 'clubs')] },
    1: { description: '同じ数字が2枚。ペアが同じなら、残りのカードを高い順に比べます。', cards: [sample(8, 'clubs'), sample(8, 'diamonds'), sample(14, 'hearts'), sample(13, 'spades'), sample(3, 'clubs')] },
    0: { description: 'どの役もできていない状態です。一番高いカードから順に比べます。', cards: [sample(14, 'clubs'), sample(11, 'diamonds'), sample(9, 'hearts'), sample(6, 'spades'), sample(3, 'clubs')] },
  };

  const list = node('div', 'hand-rank-list');
  for (let category = 9; category >= 0; category--) {
    const example = examples[category]!;
    const article = node('article', 'hand-rank-card');
    const heading = node('div', 'hand-rank-heading');
    heading.append(node('span', 'hand-rank-number', String(10 - category).padStart(2, '0')));
    heading.append(node('h2', '', HAND_NAMES[category as HandCategory]));
    const cards = node('div', 'card-row rank-example-cards');
    for (const card of example.cards) cards.append(cardElement(card, false, 'md'));
    article.append(heading, node('p', 'hand-rank-description', example.description), cards);
    list.append(article);
  }
  main.append(list);
  const note = node('aside', 'hand-rules-note');
  note.append(node('strong', '', '覚えておきたいこと'), node('p', '', '役の強さが同じならキッカーを比べます。スートに強弱はありません。7枚すべてではなく、最も強い5枚で役を判定します。'));
  main.append(note, bottomNav(pageLink('ホームへ戻る', '/'), pageLink('用語集を見る →', '/glossary'), pageLink('AIと対戦する →', '/ai')));
  shell.append(main, siteFooter());
  app.replaceChildren(shell);
}
