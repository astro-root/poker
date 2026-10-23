import { node } from './dom.ts';

export type SitePage = 'home' | 'ai' | 'online' | 'glossary' | 'hands' | 'terms' | 'privacy';
export const SITE_NAME = 'Poker Colosseum';
/** Browser title and SEO/share metadata. The logo and headings use SITE_NAME alone. */
export const SITE_TITLE = 'Poker Colosseum — Online Texas Hold’em';
export const SITE_TAGLINE = 'Step Into the Colosseum.';
export const PARENT_SITE_URL = 'https://astro-root.com';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

/** Brand mark: a gold spade above colosseum arches. Mirrors public/favicon.svg. */
export function logoMark(size = 32): SVGSVGElement {
  const root = svg('svg', { viewBox: '0 0 64 64', width: String(size), height: String(size), 'aria-hidden': 'true', focusable: 'false', class: 'logo-mark' });
  const defs = svg('defs', {});
  const gradient = svg('linearGradient', { id: 'logo-gold', x1: '0', y1: '0', x2: '0', y2: '1' });
  gradient.append(svg('stop', { offset: '0', 'stop-color': '#f4d37e' }), svg('stop', { offset: '1', 'stop-color': '#c8962f' }));
  defs.append(gradient);
  root.append(
    defs,
    svg('rect', { width: '64', height: '64', rx: '15', fill: '#0b0b0d' }),
    svg('rect', { x: '1.5', y: '1.5', width: '61', height: '61', rx: '13.5', fill: 'none', stroke: '#d9ae4a', 'stroke-opacity': '.55', 'stroke-width': '1.5' }),
    svg('path', { fill: 'url(#logo-gold)', d: 'M32 8.5c-1.6 2.2-14.5 11-14.5 19.2 0 4.6 3.7 7.1 7.4 6.2-.3 2.6-1.7 4.6-3.7 6h21.6c-2-1.4-3.4-3.4-3.7-6 3.7.9 7.4-1.6 7.4-6.2C46.5 19.5 33.6 10.7 32 8.5z' }),
    svg('path', { fill: 'url(#logo-gold)', 'fill-rule': 'evenodd', d: 'M10 42.5h44V54H10zM15 54v-6.5a3.5 3.5 0 0 1 7 0V54zm13 0v-6.5a3.5 3.5 0 0 1 8 0V54zm14 0v-6.5a3.5 3.5 0 0 1 7 0V54z' }),
  );
  return root;
}

export function pageLink(label: string, href: string, active = false): HTMLAnchorElement {
  const link = node('a', `page-nav-link${active ? ' active-page-link' : ''}`, label) as HTMLAnchorElement;
  link.href = href;
  if (active) link.setAttribute('aria-current', 'page');
  return link;
}

export function brandLink(): HTMLAnchorElement {
  const brand = node('a', 'brand') as HTMLAnchorElement;
  brand.href = '/';
  brand.setAttribute('aria-label', `${SITE_NAME} ホーム`);
  const words = node('span', 'brand-words');
  words.append(node('span', 'brand-top', 'POKER'), node('span', 'brand-bottom', 'COLOSSEUM'));
  brand.append(logoMark(34), words);
  return brand;
}

export function siteHeader(page: SitePage): HTMLElement {
  const header = node('header', 'site-header');
  const inner = node('div', 'site-header-inner');
  const nav = node('nav', 'page-nav');
  nav.setAttribute('aria-label', 'メインナビゲーション');
  nav.append(
    pageLink('ホーム', '/', page === 'home'),
    pageLink('AI対戦', '/ai', page === 'ai'),
    pageLink('オンライン', '/online', page === 'online'),
    pageLink('用語集', '/glossary', page === 'glossary'),
    pageLink('役一覧', '/hands', page === 'hands'),
  );
  inner.append(brandLink(), nav);
  header.append(inner);
  return header;
}

export function siteFooter(): HTMLElement {
  const footer = node('footer', 'site-footer');
  const inner = node('div', 'site-footer-inner');
  const left = node('div', 'footer-brand');
  left.append(logoMark(22), node('span', '', SITE_NAME));
  const nav = node('nav', 'footer-links');
  nav.setAttribute('aria-label', 'フッター');
  nav.append(pageLink('利用規約', '/terms'), pageLink('プライバシーポリシー', '/privacy'));
  const parent = node('a', 'page-nav-link', 'astro-root') as HTMLAnchorElement;
  parent.href = PARENT_SITE_URL;
  parent.target = '_blank';
  parent.rel = 'noopener noreferrer';
  parent.setAttribute('aria-label', 'astro-root（親サイト・新しいタブで開きます）');
  nav.append(parent);
  inner.append(left, nav, node('p', 'footer-note', '©2026 astro-root'));
  footer.append(inner);
  return footer;
}
