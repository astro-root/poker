import type { Card } from '../../poker/cards.ts';
import { cardElement } from './card.ts';
import { formatChips, node } from '../dom.ts';

export type SeatProps = Readonly<{
  name: string;
  kind: 'you' | 'ai' | 'player';
  tag?: string;
  stack: number;
  stackRatio: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  active: boolean;
  dealer: boolean;
  away?: boolean;
  holeCards: readonly [Card, Card] | null;
  showCards: boolean;
  winner?: boolean;
}>;

function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?';
}

/**
 * Seat card: identity, chips and status only. The player's own hand is rendered separately in the dock (A-1),
 * so status text lives inside the card and never overlaps cards or the pot.
 */
export function renderSeat(props: SeatProps): HTMLElement {
  const classes = ['seat', `seat-${props.kind}`];
  if (props.active) classes.push('is-active');
  if (props.folded) classes.push('is-folded');
  if (props.allIn) classes.push('is-allin');
  if (props.winner) classes.push('is-winner');
  if (props.away) classes.push('is-away');
  const seat = node('div', classes.join(' '));

  const head = node('div', 'seat-head');
  head.append(node('span', 'seat-avatar', props.kind === 'you' ? 'YOU' : initial(props.name)));
  const identity = node('div', 'seat-identity');
  const name = node('strong', 'seat-name', props.name);
  name.title = props.name;
  identity.append(name);
  if (props.tag) identity.append(node('span', 'seat-tag', props.tag));
  head.append(identity);
  if (props.dealer) {
    const dealer = node('span', 'dealer-chip', 'D');
    dealer.setAttribute('aria-label', 'ディーラーボタン');
    head.append(dealer);
  }
  seat.append(head);

  const mid = node('div', 'seat-mid');
  const stack = node('div', 'seat-stack');
  stack.append(node('span', 'seat-stack-value', formatChips(props.stack)));
  stack.append(node('span', 'seat-stack-unit', 'チップ'));
  mid.append(stack);
  if (props.kind !== 'you') {
    const cards = node('div', 'seat-cards');
    const visible = props.showCards && props.holeCards !== null;
    cards.append(cardElement(visible ? props.holeCards![0] : null, !visible, 'xs'), cardElement(visible ? props.holeCards![1] : null, !visible, 'xs'));
    if (props.folded) cards.classList.add('is-mucked');
    mid.append(cards);
  }
  seat.append(mid);

  const status = node('div', 'seat-status');
  if (props.bet > 0) status.append(node('span', 'seat-bet', `ベット ${formatChips(props.bet)}`));
  const label = props.winner ? '勝利' : props.folded ? 'フォールド' : props.away ? '離席中' : props.allIn ? 'オールイン' : props.active ? '考え中' : '';
  if (label) status.append(node('span', `seat-state${props.active && !props.folded ? ' state-active' : ''}${props.winner ? ' state-winner' : ''}`, props.active && props.kind === 'you' ? 'あなたの番' : label));
  if (!props.bet && !label) status.append(node('span', 'seat-state state-idle', '待機'));
  seat.append(status);
  const meter = node('span', 'stack-meter');
  meter.setAttribute('aria-hidden', 'true');
  const fill = node('span', 'stack-meter-fill');
  fill.style.width = `${Math.max(0, Math.min(1, props.stackRatio)) * 100}%`;
  meter.append(fill);
  seat.append(meter);
  return seat;
}
