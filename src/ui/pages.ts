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


type RuleSection = Readonly<{ title: string; paragraphs: readonly string[] }>;

const RULES: readonly RuleSection[] = [
  { title: '1. ゲームの目的', paragraphs: [
    'テキサスホールデムは、自分の手札2枚と、テーブル中央に公開される共通カード5枚の合計7枚から、最も強い5枚で役を作って競うゲームです。',
    '最後まで残って最も強い役を持つか、全員を降ろしてポットを獲得すれば、そのハンドの勝ちです。ここではバーチャルチップだけを使います。',
  ] },
  { title: '2. ハンドの準備', paragraphs: [
    'ディーラーボタン（D）は、ハンドごとに左隣へ移ります。ボタンの左隣がスモールブラインド、その隣がビッグブラインドで、カードが配られる前に強制的にチップを出します。',
    'ルームの設定でアンティが決まっている場合は、全員がブラインドより先に同じ額を出します。',
    '各プレイヤーに、自分だけが見られる手札が2枚配られます。',
  ] },
  { title: '3. ハンドの流れ', paragraphs: [
    '①プリフロップ：手札が配られた直後のベッティングラウンド。ビッグブラインドの左隣から行動します。',
    '②フロップ：共通カードが3枚公開されます。ボタンの左隣から行動します。',
    '③ターン：4枚目の共通カードが公開されます。',
    '④リバー：5枚目の共通カードが公開されます。最後のベッティングラウンドです。',
    '⑤ショーダウン：最後まで残った人が手札を公開し、役を比べます。全員がフォールドした場合は、公開せずに残った1人が勝ちます。',
  ] },
  { title: '4. できる行動', paragraphs: [
    'チェック：誰もベットしていないとき、チップを出さずに順番を進めます。',
    'ベット／レイズ：チップを賭ける、または相手の賭け額を上げます。レイズは、直前の上げ幅以上にする必要があります。',
    'コール：相手の賭け額に合わせます。',
    'フォールド：そのハンドから降ります。すでに出したチップは戻りません。',
    'オールイン：残りのチップをすべて賭けます。誤操作を防ぐため、実行前にもう一度確認が出ます。',
  ] },
  { title: '5. オールインとサイドポット', paragraphs: [
    'チップが足りないままコールすると、その人は持っている分だけでオールインになります。オールインした人は、自分が出した額までのポットだけを争えます。',
    'それより多く賭けた人たちの間では、サイドポットが別に作られ、その分は残りの人だけで争います。誰にもコールされなかった超過分は、本人に返ります。',
    '全員がオールインした場合は、行動なしで残りの共通カードが公開されます。',
  ] },
  { title: '6. 勝敗と引き分け', paragraphs: [
    '役の強さは「役一覧」で確認できます。同じ役のときは、まず役を作っている数字、次にキッカー（残りの最も強いカード）で比べます。スートに強弱はありません。',
    '完全に同じ強さなら、ポットは均等に分けられます。',
  ] },
  { title: '7. このサービス独自のルール', paragraphs: [
    '設定：初期スタック、ハンド数、ブラインド、アンティ、ブラインドの上昇、手役の表示は、ホストがルーム設定で決めます。対戦中の変更は次のハンドから反映され、初期スタックは変更できません。',
    'ハンド数：指定したハンド数を終えるとゲームが終わり、チップが最も多い人が優勝します。「無制限」なら、1人以外のチップがなくなるまで続きます。',
    'ブラインドの上昇：有効な場合、10ハンドごとにブラインドとアンティが2倍になります。',
    '持ち時間（オンライン）：1回の手番は45秒です。時間切れになると、チェックできるときは自動でチェック、それ以外は自動でフォールドします。',
    '観戦：観戦者は、手札を見ることも、プレイヤーとして操作することもできません。ショーダウンで公開されたカードだけが見えます。',
    'ホストの権限：ホストは設定の変更と、参加者の退場ができます。退場した人は、そのルームに戻れません。',
  ] },
];

export function renderRulesPage(app: HTMLElement, sitePage: SitePage): void {
  setMeta(`ポーカーのルール — ${SITE_NAME}`);
  const shell = node('div', 'page-shell');
  shell.append(siteHeader(sitePage));
  const main = node('main', 'content rules');
  main.append(contentIntro('HOW TO PLAY', 'ポーカーのルール', 'テキサスホールデムの流れと、このサービスで使うルールをまとめました。迷ったときはここに戻れます。'));
  const toc = node('nav', 'legal-toc');
  toc.setAttribute('aria-label', '目次');
  toc.append(node('h2', 'legal-toc-title', '目次'));
  const list = node('ol', 'legal-toc-list');
  RULES.forEach((section, index) => {
    const item = node('li');
    const link = node('a', '', section.title.replace(/^\d+\.\s*/u, '')) as HTMLAnchorElement;
    link.href = `#rule-${index + 1}`;
    item.append(link);
    list.append(item);
  });
  toc.append(list);
  main.append(toc);
  RULES.forEach((section, index) => {
    const article = node('section', 'legal-section reveal');
    article.id = `rule-${index + 1}`;
    article.append(node('h2', 'legal-heading', section.title));
    for (const paragraph of section.paragraphs) article.append(node('p', '', paragraph));
    main.append(article);
  });
  const next = node('nav', 'content-bottom-nav');
  next.append(pageLink('役の強さ一覧 →', '/hands'), pageLink('用語集を見る →', '/glossary'), pageLink('AI対戦で練習する →', '/ai'));
  main.append(next);
  shell.append(main, siteFooter());
  app.replaceChildren(shell);
}
