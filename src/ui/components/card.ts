import type { Card } from '../../poker/cards.ts';
import { node } from '../dom.ts';

export function cardLabel(card: Card): string {
  const rank = card.rank <= 10 ? String(card.rank) : ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[card.rank];
  const suit = ({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' } as const)[card.suit];
  return `${rank}${suit}`;
}

export function cardElement(card: Card | null, hidden = false): HTMLElement {
  if (hidden || !card) {
    const back = node('span', 'playing-card card-back', '✦');
    back.setAttribute('aria-label', '非公開のカード');
    return back;
  }
  const red = card.suit === 'hearts' || card.suit === 'diamonds';
  const face = node('span', `playing-card${red ? ' red-suit' : ''}`);
  face.setAttribute('aria-label', cardLabel(card));
  face.append(node('span', 'card-rank', cardLabel(card).slice(0, -1)));
  face.append(node('span', 'card-suit', cardLabel(card).slice(-1)));
  return face;
}

