import type { Card as CardType, CardAbility, GemColor, TokenColor } from '@splendor-duel/game-engine';
import { TOKEN_COLORS, effectiveCardColor } from '@splendor-duel/game-engine';
import { Gem } from '../Gem/Gem';
import styles from './Card.module.css';

export interface CardProps {
  card: CardType;
  canBuy?: boolean;
  canReserve?: boolean;
  onBuy?: () => void;
  onReserve?: () => void;
}

/**
 * The wild half of an ability is already shown by the card's band ("Wild" until
 * a colour is assigned, the colour itself afterwards), so only the remainder
 * needs a label.
 */
const ABILITY_LABEL: Record<CardAbility, string | null> = {
  Turn: 'Extra turn',
  Token: 'Take gem',
  Take: 'Steal',
  Privilege: 'Privilege',
  wild: null,
  'wild and turn': 'Extra turn',
};

/**
 * A jewel card.
 *
 * Every dimension inside the card is a multiple of `--card-w`, which the
 * container sets. That is what lets the same component serve the pyramid and
 * the reserved row at different sizes without a size prop.
 *
 * Layout mirrors the physical card: a band in the card's colour carrying the
 * prestige and the bonus, crowns and ability in the middle, cost along the
 * bottom.
 */
export function Card({ card, canBuy, canReserve, onBuy, onReserve }: CardProps) {
  const color: GemColor | null = effectiveCardColor(card);
  const abilityLabel = card.ability ? ABILITY_LABEL[card.ability] : null;
  const hasActions = (canBuy && onBuy) || (canReserve && onReserve);

  const cls = [
    styles.card,
    styles[color ?? 'wild'],
    canBuy && styles.affordable,
  ].filter(Boolean).join(' ');

  const costEntries = TOKEN_COLORS
    .map(c => [c, card.cost[c] ?? 0] as [TokenColor, number])
    .filter(([, n]) => n > 0);

  return (
    <div className={cls}>
      <div className={styles.band}>
        <span className={styles.points}>{card.points > 0 ? card.points : ''}</span>
        <span className={styles.bonus}>
          {color === null
            ? <span className={styles.wildMark}>Wild</span>
            : Array.from({ length: card.bonus }).map((_, i) => (
                <Gem key={i} color={color} size="sm" label={`${color} bonus`} />
              ))}
        </span>
      </div>

      <div className={styles.middle}>
        {card.crowns > 0 && (
          <span className={styles.crowns} title={`${card.crowns} crown${card.crowns === 1 ? '' : 's'}`}>
            {'♛'.repeat(card.crowns)}
          </span>
        )}
        {abilityLabel && <span className={styles.ability}>{abilityLabel}</span>}
      </div>

      <div className={styles.cost}>
        {costEntries.map(([c, n]) => (
          <span key={c} className={`${styles.pip} ${styles[`pip-${c}`]}`} title={`${n} ${c}`}>{n}</span>
        ))}
      </div>

      {hasActions && (
        <div className={styles.actions}>
          {canBuy && onBuy && <button className="primary" onClick={onBuy}>Buy</button>}
          {canReserve && onReserve && <button onClick={onReserve}>Reserve</button>}
        </div>
      )}
    </div>
  );
}

// ─── Face-down deck ──────────────────────────────────────────────────────────

export interface CardBackProps {
  level: 1 | 2 | 3;
  remaining: number;
  canReserve?: boolean;
  onReserve?: () => void;
}

export function CardBack({ level, remaining, canReserve, onReserve }: CardBackProps) {
  return (
    <div className={`${styles.card} ${styles.back}`} data-level={level}>
      <span className={styles.backLabel}>Level</span>
      <span className={styles.backLevel}>{level}</span>
      <span className={styles.backCount}>{remaining} left</span>
      {canReserve && onReserve && (
        <div className={styles.actions}>
          <button onClick={onReserve}>Reserve top</button>
        </div>
      )}
    </div>
  );
}

// ─── Empty pyramid slot ─────────────────────────────────────────────────────

export function EmptyCardSlot() {
  return <div className={`${styles.card} ${styles.empty}`} />;
}
