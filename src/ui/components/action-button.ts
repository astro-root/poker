import type { BettingAction } from '../../poker/betting.ts';
import { node } from '../dom.ts';

export type ActionTone = 'fold' | 'neutral' | 'raise' | 'allin' | 'ghost';

export function createActionButton(label: string, action: BettingAction, tone: ActionTone, disabled: boolean, onAction: (action: BettingAction) => void, hint?: string): HTMLButtonElement {
  const button = node('button', `action-button tone-${tone}`);
  button.type = 'button';
  button.disabled = disabled;
  button.append(node('span', 'action-label', label));
  if (hint) button.append(node('span', 'action-hint-text', hint));
  button.addEventListener('click', () => onAction(action));
  return button;
}
