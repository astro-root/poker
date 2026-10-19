import type { Card } from '../poker/cards.ts';
import { HAND_NAMES, type HandCategory } from '../poker/evaluator.ts';
import { POKER_GLOSSARY } from '../poker/education.ts';
import { node } from './dom.ts';
import { cardElement } from './components/card.ts';

export type SitePage = 'home' | 'ai' | 'online' | 'terms' | 'hands';

export function pageLink(label: string, href: string, active = false): HTMLAnchorElement {
  const link = node('a', `page-nav-link${active ? ' active-page-link' : ''}`, label) as HTMLAnchorElement;
  link.href = href;
  if (active) link.setAttribute('aria-current', 'page');
  return link;
}

export function staticPageHeader(sitePage: SitePage): HTMLElement {
  const header = node('header', 'topbar site-topbar');
  const brand = pageLink('POKER TABLE', '/', false);
  brand.classList.add('brand');
  const nav = node('nav', 'page-nav');
  nav.setAttribute('aria-label', 'メインナビゲーション');
  nav.append(
    pageLink('トップ', '/', sitePage === 'home'),
    pageLink('AI対戦', '/ai', sitePage === 'ai'),
    pageLink('オンライン', '/online', sitePage === 'online'),
    pageLink('用語', '/terms', sitePage === 'terms'),
    pageLink('役一覧', '/hands', sitePage === 'hands'),
  );
  header.append(brand, nav);
  return header;
}

export function renderHomePage(app: HTMLElement, sitePage: SitePage): void {
  document.title = 'POKER TABLE — テキサスホールデム';
  const shell = node('main', 'page-shell landing-shell');
  shell.append(staticPageHeader(sitePage));

  const hero = node('section', 'landing-hero');
  const copy = node('div', 'landing-copy');
  copy.append(node('span', 'eyebrow', 'TEXAS HOLD’EM · PLAY FOR FREE'));
  copy.append(node('h1', '', '次の一手を、\nテーブルの上で。'));
  copy.append(node('p', 'landing-lead', 'ルールを学びながら、AIとも友だちとも楽しめるテキサスホールデム。登録なしで始められます。'));
  const actions = node('div', 'landing-actions');
  actions.append(pageLink('AIと練習する', '/ai', false), pageLink('友だちと対戦する', '/online', false));
  actions.children[0]?.classList.add('landing-cta', 'landing-cta-primary');
  actions.children[1]?.classList.add('landing-cta', 'landing-cta-secondary');
  copy.append(actions);
  const trust = node('p', 'landing-note', '無料 · ゲーム内チップのみ · アカウント登録不要');
  copy.append(trust);

  const stage = node('div', 'landing-stage');
  stage.setAttribute('aria-hidden', 'true');
  const stageLabel = node('span', 'landing-stage-label', 'TABLE 01 · HOLD’EM');
  const artCards = node('div', 'landing-cards');
  for (const card of [
    { rank: 14, suit: 'spades' }, { rank: 14, suit: 'hearts' }, { rank: 13, suit: 'spades' },
  ] as const) artCards.append(cardElement(card));
  const chips = node('div', 'landing-chip-stack');
  chips.append(node('i'), node('i'), node('i'));
  stage.append(stageLabel, artCards, chips, node('span', 'landing-stage-pot', 'POT · 1,250'));
  hero.append(copy, stage);
  shell.append(hero);

  const paths = node('section', 'landing-paths');
  paths.append(node('h2', '', '遊び方を選ぶ'));
  const pathGrid = node('div', 'landing-path-grid');
  const pathCards = [
    { href: '/ai', number: '01', title: 'AIと練習', body: '自分のペースでハンドを重ねて、判断を身につける。', link: '練習を始める →' },
    { href: '/online', number: '02', title: '友だちと対戦', body: '招待リンクを共有して、すぐにプライベート卓を作る。', link: 'オンラインへ →' },
  ];
  for (const item of pathCards) {
    const card = pageLink('', item.href);
    card.classList.add('path-card');
    card.append(node('span', 'path-number', item.number), node('strong', '', item.title), node('span', 'path-copy', item.body), node('span', 'path-link', item.link));
    pathGrid.append(card);
  }
  paths.append(pathGrid);
  shell.append(paths);

  const learning = node('section', 'landing-learning');
  learning.append(node('span', 'eyebrow', 'LEARN THE GAME'), node('h2', '', '遊びながら、少しずつ覚える。'));
  const learningLinks = node('div', 'learning-links');
  learningLinks.append(pageLink('ポーカー用語を見る →', '/terms'), pageLink('役の強さを確認する →', '/hands'));
  learning.append(learningLinks);
  shell.append(learning);
  shell.append(node('footer', 'footer-note', 'POKER TABLE · すべてのチップはゲーム内専用です。現金や賞金はありません。'));
  app.replaceChildren(shell);
}

export function renderTermsPage(app: HTMLElement, sitePage: SitePage): void {
  document.title = 'ポーカー用語集 — POKER TABLE';
  const shell = node('main', 'page-shell content-shell');
  shell.append(staticPageHeader(sitePage));
  const intro = node('section', 'content-intro');
  intro.append(node('span', 'eyebrow', 'POKER GLOSSARY'), node('h1', '', 'ポーカー用語集'), node('p', '', 'テキサスホールデムでよく使う言葉を、短い説明と例でまとめました。'));
  shell.append(intro);
  const list = node('div', 'term-list');
  for (const [index, entry] of POKER_GLOSSARY.entries()) {
    const article = node('article', 'term-card');
    article.append(node('span', 'term-index', String(index + 1).padStart(2, '0')), node('h2', '', entry.term));
    article.append(node('p', '', entry.explanation), node('p', 'term-example', entry.example));
    list.append(article);
  }
  shell.append(list);
  const bottom = node('nav', 'content-bottom-nav');
  bottom.setAttribute('aria-label', '次のページ');
  bottom.append(pageLink('トップへ戻る', '/'), pageLink('役一覧を見る →', '/hands'), pageLink('AIと練習する →', '/ai'));
  shell.append(bottom, node('footer', 'footer-note', 'POKER TABLE · テキサスホールデム'));
  app.replaceChildren(shell);
}

export function renderHandsPage(app: HTMLElement, sitePage: SitePage): void {
  document.title = 'ポーカーの役一覧 — POKER TABLE';
  const shell = node('main', 'page-shell content-shell');
  shell.append(staticPageHeader(sitePage));
  const intro = node('section', 'content-intro');
  intro.append(node('span', 'eyebrow', 'HAND RANKINGS'), node('h1', '', '役の強さ一覧'), node('p', '', 'テキサスホールデムでは、手札2枚と共通カードから最も強い5枚を選びます。上から順に強い役です。'));
  shell.append(intro);

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
    for (const card of example.cards) cards.append(cardElement(card));
    article.append(heading, node('p', 'hand-rank-description', example.description), cards);
    list.append(article);
  }
  shell.append(list);
  const note = node('aside', 'hand-rules-note');
  note.append(node('strong', '', '覚えておきたいこと'), node('p', '', '役の強さが同じならキッカーを比べます。スートに強弱はありません。7枚すべてではなく、最も強い5枚で役を判定します。'));
  shell.append(note);
  const bottom = node('nav', 'content-bottom-nav');
  bottom.setAttribute('aria-label', '次のページ');
  bottom.append(pageLink('トップへ戻る', '/'), pageLink('用語集を見る →', '/terms'), pageLink('AIと練習する →', '/ai'));
  shell.append(bottom, node('footer', 'footer-note', 'POKER TABLE · テキサスホールデム'));
  app.replaceChildren(shell);
}

