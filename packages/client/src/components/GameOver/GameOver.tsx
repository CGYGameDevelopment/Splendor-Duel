import type { ClientGameState } from '@splendor-duel/protocol';
import styles from './GameOver.module.css';

const CONDITION_LABEL: Record<string, string> = {
  prestige: 'reaching 20 prestige points',
  crowns: 'collecting 10 crowns',
  color_prestige: 'reaching 10 prestige in a single color',
};

export interface GameOverProps {
  state: ClientGameState;
  myPlayerId: 0 | 1 | null;
  onPlayAgain: () => void;
}

export function GameOver({ state, myPlayerId, onPlayAgain }: GameOverProps) {
  const youWon = state.winner !== null && state.winner === myPlayerId;
  const winnerLabel = state.winner === null ? '—' : `Player ${state.winner}`;
  const condition = state.winCondition ? CONDITION_LABEL[state.winCondition] ?? state.winCondition : '';

  return (
    <div className={styles.banner}>
      <div className={styles.title}>Game over</div>
      <div className={`${styles.outcome} ${youWon ? styles.win : styles.lose}`}>
        {youWon ? 'You win!' : `${winnerLabel} wins`}
      </div>
      {condition && <div className={styles.subtle}>by {condition}</div>}
      <div className={styles.actions}>
        <button className="primary" onClick={onPlayAgain}>Back to lobby</button>
      </div>
    </div>
  );
}
