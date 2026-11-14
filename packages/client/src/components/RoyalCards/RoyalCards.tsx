import type { Card as CardType, CardAbility } from '@splendor-duel/game-engine';
import { CROWN_MILESTONES } from '@splendor-duel/game-engine';
import type { ClientGameState } from '@splendor-duel/protocol';
import styles from './RoyalCards.module.css';

export interface RoyalCardsProps {
  state: ClientGameState;
}

const ABILITY_LABEL: Partial<Record<CardAbility, string>> = {
  Turn: 'Extra turn',
  Token: 'Take gem',
  Take: 'Steal',
  Privilege: 'Privilege',
};

/**
 * Royal cards get their own tile rather than reusing the jewel Card: they have
 * no cost, colour or bonus, only prestige and an optional ability.
 */
export function RoyalCard({ card, onClick }: { card: CardType; onClick?: () => void }) {
  const content = (
    <>
      <span className={styles.points}>♛ {card.points}</span>
      <span className={styles.ability}>
        {card.ability ? ABILITY_LABEL[card.ability] ?? card.ability : 'No ability'}
      </span>
    </>
  );
  return onClick
    ? <button className={styles.royal} onClick={onClick}>{content}</button>
    : <div className={styles.royal}>{content}</div>;
}

export function RoyalCards({ state }: RoyalCardsProps) {
  return (
    <div className={`surface ${styles.royalArea}`}>
      <div className={styles.label}>
        Royal cards
        <span className={styles.hint}>claimed at {CROWN_MILESTONES.join(' and ')} crowns</span>
      </div>
      <div className={styles.cards}>
        {state.royalDeck.length === 0
          ? <span className={styles.empty}>All claimed</span>
          : state.royalDeck.map(card => <RoyalCard key={card.id} card={card} />)}
      </div>
    </div>
  );
}
