import type { Card } from '../../poker/cards.ts';
import { node } from '../dom.ts';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

export function cardLabel(card: Card): string {
  const rank = card.rank <= 10 ? String(card.rank) : ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[card.rank];
  const suit = ({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' } as const)[card.suit];
  return `${rank}${suit}`;
}

const SUIT_NAME = { clubs: 'クラブ', diamonds: 'ダイヤ', hearts: 'ハート', spades: 'スペード' } as const;

export function cardElement(card: Card | null, hidden = false, size: CardSize = 'md'): HTMLElement {
  if (hidden || !card) {
    const back = node('span', `playing-card card-back card-${size}`);
    back.setAttribute('aria-label', '非公開のカード');
    back.setAttribute('role', 'img');
    return back;
  }
  const red = card.suit === 'hearts' || card.suit === 'diamonds';
  const face = node('span', `playing-card card-${size}${red ? ' red-suit' : ''}`);
  face.setAttribute('role', 'img');
  face.setAttribute('aria-label', `${SUIT_NAME[card.suit]}の${cardLabel(card).slice(0, -1)}`);
  face.append(node('span', 'card-rank', cardLabel(card).slice(0, -1)));
  face.append(node('span', 'card-suit', cardLabel(card).slice(-1)));
  return face;
}

/** An empty board slot so the five community positions stay visible before they are dealt. */
export function emptyCardSlot(size: CardSize = 'md'): HTMLElement {
  const slot = node('span', `playing-card card-slot card-${size}`);
  slot.setAttribute('aria-hidden', 'true');
  return slot;
}
