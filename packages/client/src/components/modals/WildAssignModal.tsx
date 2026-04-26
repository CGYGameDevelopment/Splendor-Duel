import type { GemColor, TokenColor } from '@splendor-duel/game-engine';
import { Modal, modalStyles } from './Modal';
import { Token } from '../Token/Token';
import type { LegalMovesIndex } from '../../actions/legalMovesIndex';

export interface WildAssignModalProps {
  legal: LegalMovesIndex;
  onAssign: (color: GemColor) => void;
}

export function WildAssignModal({ legal, onAssign }: WildAssignModalProps) {
  const colors = Array.from(legal.assignWildByColor.keys()) as GemColor[];

  return (
    <Modal title="Assign wild card color">
      <p>Choose a color for the wild card you just purchased. The card will permanently take this color.</p>
      <div className={modalStyles.options}>
        {colors.length === 0 && <span>No colors available — purchase a colored card first.</span>}
        {colors.map(c => (
          <button key={c} className={modalStyles.tokenButton} onClick={() => onAssign(c)}>
            <Token color={c as TokenColor} size="md" />
            <span>{c}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
