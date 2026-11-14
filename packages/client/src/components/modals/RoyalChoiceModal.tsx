import type { ClientGameState } from '@splendor-duel/protocol';
import { Modal, modalStyles } from './Modal';
import { RoyalCard } from '../RoyalCards/RoyalCards';

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
          <RoyalCard key={card.id} card={card} onClick={() => onChoose(card.id)} />
        ))}
      </div>
    </Modal>
  );
}
