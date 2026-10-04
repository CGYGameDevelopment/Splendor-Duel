import type { Card as CardType } from '@splendor-duel/game-engine';
import type { ClientGameState } from '@splendor-duel/protocol';
import styles from './RoyalCards.module.css';

export interface RoyalCardsProps {
  state: ClientGameState;
}

const ABILITY_LABEL: Record<string, string> = {
  Turn: 'Extra turn',
  Token: 'Take a token',
  Take: 'Steal a token',
  Privilege: 'Gain privilege',
};

const ABILITY_ICON: Record<string, string> = {
  Turn: '↻',
  Token: '◈',
  Take: '✋',
  Privilege: '📜',
};

/**
 * Royal cards get their own tile rather than reusing the jewel Card.
 *
 * They have no cost, no gem colour and no bonus, so the jewel card rendered
 * them with an empty "Free" cost tray and a wild marker — three pieces of
 * furniture that mean nothing here. A royal is claimed by reaching a crown
 * milestone, so the tile leads with its prestige and its ability instead.
 */
export function RoyalCard({ card }: { card: CardType }) {
  return (
    <div className={styles.royal}>
      <span className={styles.crown}>♛</span>
      <span className={styles.points}>{card.points}</span>
      <span className={styles.pointsLabel}>prestige</span>
      {card.ability && (
        <span className={styles.ability}>
          <span className={styles.abilityIcon}>{ABILITY_ICON[card.ability] ?? '✦'}</span>
          {ABILITY_LABEL[card.ability] ?? card.ability}
        </span>
      )}
    </div>
  );
}

export function RoyalCards({ state }: RoyalCardsProps) {
  return (
    <div className={styles.royalArea}>
      <div className={styles.label}>
        Royal cards
        <span className={styles.hint}>claimed at 3 and 6 crowns</span>
      </div>
      <div className={styles.cards}>
        {state.royalDeck.length === 0
          ? <span className={styles.empty}>All claimed</span>
          : state.royalDeck.map(card => <RoyalCard key={card.id} card={card} />)}
      </div>
    </div>
  );
}
