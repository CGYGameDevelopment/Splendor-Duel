import type { TokenColor } from '@splendor-duel/game-engine';
import { TOKEN_COLORS, MAX_TOKENS } from '@splendor-duel/game-engine';
import type { ClientGameState } from '@splendor-duel/protocol';
import { Modal, modalStyles } from './Modal';
import { Token } from '../Token/Token';
import type { LegalMovesIndex } from '../../actions/legalMovesIndex';

export interface DiscardModalProps {
  state: ClientGameState;
  legal: LegalMovesIndex;
  playerId: 0 | 1;
  onDiscard: (color: TokenColor) => void;
}

export function DiscardModal({ state, legal, playerId, onDiscard }: DiscardModalProps) {
  const player = state.players[playerId];
  const total = TOKEN_COLORS.reduce((s, c) => s + (player.tokens[c] ?? 0), 0);
  const excess = total - MAX_TOKENS;

  return (
    <Modal title={`Discard ${excess > 0 ? excess : 0} token${excess === 1 ? '' : 's'}`}>
      <p>You can only hold {MAX_TOKENS} tokens. Click a token to discard it.</p>
      <div className={modalStyles.optionRow}>
        {TOKEN_COLORS.map(c => {
          const n = player.tokens[c] ?? 0;
          if (n === 0) return null;
          if (!legal.discardByColor.has(c)) return null;
          return (
            <button
              key={c}
              className={modalStyles.tokenButton}
              onClick={() => onDiscard(c)}
            >
              <Token color={c} size="md" count={n > 1 ? n : undefined} />
              <span>{c}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
