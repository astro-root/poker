import { node } from './dom.ts';

/** Small inline SVG icons (stroke-based, inheriting the text colour). Icons save horizontal space on phones. */
const SVG_NS = 'http://www.w3.org/2000/svg';

type Shape = Readonly<{ d?: string; circle?: readonly [number, number, number] }>;
const ICONS: Readonly<Record<string, readonly Shape[]>> = {
  settings: [{ d: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1' }, { circle: [15, 6, 2] }, { circle: [9, 12, 2] }, { circle: [17, 18, 2] }],
  rename: [{ d: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z' }, { d: 'M14 7l3 3' }],
  leave: [{ d: 'M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4' }, { d: 'M16 8l4 4-4 4M20 12H9' }],
  info: [{ circle: [12, 12, 9] }, { d: 'M12 11v5M12 8h.01' }],
  chat: [{ d: 'M4 5h16v11H9l-5 4V5z' }],
  users: [{ circle: [9, 8, 3] }, { d: 'M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5' }, { circle: [17, 9, 2.5] }, { d: 'M17 14c2.6 0 4 1.5 4 4' }],
  eye: [{ d: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z' }, { circle: [12, 12, 3] }],
  copy: [{ d: 'M9 9h10v11H9z' }, { d: 'M5 15V4h10' }],
  chip: [{ circle: [12, 12, 9] }, { circle: [12, 12, 4] }, { d: 'M12 3v2M12 19v2M3 12h2M19 12h2' }],
  close: [{ d: 'M6 6l12 12M18 6L6 18' }],
};

export function icon(name: keyof typeof ICONS | string, size = 18): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  for (const shape of ICONS[name] ?? []) {
    if (shape.d) { const path = document.createElementNS(SVG_NS, 'path'); path.setAttribute('d', shape.d); svg.append(path); }
    if (shape.circle) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', String(shape.circle[0])); c.setAttribute('cy', String(shape.circle[1])); c.setAttribute('r', String(shape.circle[2]));
      svg.append(c);
    }
  }
  return svg;
}

/** A compact button: icon plus a text label that is hidden on narrow screens (kept for screen readers and tooltips). */
export function iconButton(name: string, label: string, extraClass = 'button-ghost'): HTMLButtonElement {
  const button = node('button', `button button-small icon-btn ${extraClass}`);
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(icon(name), node('span', 'btn-label', label));
  return button;
}

export function iconLink(name: string, label: string, href: string): HTMLAnchorElement {
  const link = node('a', 'button button-small icon-btn button-ghost') as HTMLAnchorElement;
  link.href = href;
  link.title = label;
  link.setAttribute('aria-label', label);
  link.append(icon(name), node('span', 'btn-label', label));
  return link;
}
