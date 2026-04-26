import type { ClientGameState } from '@splendor-duel/protocol';
import { Modal, modalStyles } from './Modal';
import { Card } from '../Card/Card';

export interface RoyalChoiceModalProps {
  state: ClientGameState;
  onChoose: (cardId: number) => void;
}

export function RoyalChoiceModal({ state, onChoose }: RoyalChoiceModalProps) {
  return (
    <Modal title="Choose a royal card">
      <p>You hit a crown milestone — pick a royal card.</p>
      <div className={modalStyles.options}>
        {state.royalDeck.map(card => (
          <div key={card.id} className={modalStyles.cardChoice} onClick={() => onChoose(card.id)}>
            <Card card={card} size="md" />
          </div>
        ))}
      </div>
    </Modal>
  );
}
