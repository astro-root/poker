import type { Card } from '../../poker/cards.ts';
import { cardElement } from './card.ts';
import { formatChips, node } from '../dom.ts';

export function renderSeat(name: string, seat: { id: string; stack: number; folded: boolean; holeCards: readonly [Card, Card] | null; streetContribution: number } | undefined, active: boolean, showCards: boolean, isDealer: boolean, revealOpponentCards = false, stackRatio = 1, isOnline = false): HTMLElement {
  const card = node('div', `player-seat${active ? ' active-seat' : ''}${seat?.folded ? ' folded-seat' : ''}${showCards ? ' human-seat' : ''}`);
  const avatar = node('span', 'avatar', showCards ? 'YOU' : isOnline ? 'P' : 'AI');
  const details = node('div', 'seat-details');
  details.append(node('strong', '', name));
  details.append(node('span', 'seat-stack', `${formatChips(seat?.stack ?? 0)} チップ`));
  const stackMeter = node('span', 'stack-meter');
  stackMeter.setAttribute('aria-hidden', 'true');
  const stackFill = node('span', 'stack-meter-fill');
  stackFill.style.width = `${Math.max(0, Math.min(1, stackRatio)) * 100}%`;
  stackMeter.append(stackFill);
  details.append(stackMeter);
  if (seat && seat.streetContribution > 0) details.append(node('span', 'seat-bet', `ベット ${formatChips(seat.streetContribution)}`));
  card.append(avatar, details);
  if (isDealer) card.append(node('span', 'dealer-button', 'D'));
  const cards = node('div', 'card-row hole-cards');
  const holeCards = seat?.holeCards;
  const cardsVisible = showCards || revealOpponentCards;
  cards.append(cardElement(holeCards?.[0] ?? null, !cardsVisible || !holeCards));
  cards.append(cardElement(holeCards?.[1] ?? null, !cardsVisible || !holeCards));
  card.append(cards);
  if (seat?.folded) card.append(node('span', 'folded-label', 'フォールド'));
  if (active) card.append(node('span', 'seat-turn-label', 'アクション中'));
  return card;
}

