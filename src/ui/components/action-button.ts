import type { BettingAction } from '../../poker/betting.ts';
import { node } from '../dom.ts';

export function createActionButton(label: string, action: BettingAction, style: string, disabled: boolean, onAction: (action: BettingAction) => void): HTMLButtonElement {
  const button = node('button', `action-button ${style}`, label);
  button.type = 'button';
  button.disabled = disabled;
  button.addEventListener('click', () => onAction(action));
  return button;
}

