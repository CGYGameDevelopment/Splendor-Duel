import type { ClientGameState } from '@splendor-duel/protocol';
import { Card } from '../Card/Card';
import styles from './RoyalCards.module.css';

export interface RoyalCardsProps {
  state: ClientGameState;
}

export function RoyalCards({ state }: RoyalCardsProps) {
  return (
    <div className={styles.royalArea}>
      <div className={styles.label}>Royal cards</div>
      <div className={styles.cards}>
        {state.royalDeck.length === 0
          ? <span className={styles.empty}>(none available)</span>
          : state.royalDeck.map(card => (
              <Card key={card.id} card={card} size="sm" />
            ))}
      </div>
    </div>
  );
}
