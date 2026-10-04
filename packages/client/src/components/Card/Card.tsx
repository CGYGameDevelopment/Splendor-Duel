import type { Card as CardType, GemColor, TokenColor } from '@splendor-duel/game-engine';
import { TOKEN_COLORS } from '@splendor-duel/game-engine';
import { Token } from '../Token/Token';
import styles from './Card.module.css';

export type CardSize = 'sm' | 'md' | 'lg';

export interface CardProps {
  card: CardType;
  size?: CardSize;
  canBuy?: boolean;
  canReserve?: boolean;
  onBuy?: () => void;
  onReserve?: () => void;
  onClick?: () => void;       // generic click (used for choose-royal etc.)
}

const ABILITY_LABEL: Record<string, string> = {
  Turn: '↻ Extra turn',
  Token: '◈ Take token',
  Take: '✋ Steal',
  Privilege: '📜 Privilege',
  wild: '✦ Wild',
  'wild and turn': '✦ Wild · ↻',
};

/**
 * The outer shell owns the perspective, the inner element does the rotating.
 * They have to be separate: a transform on the same element the perspective is
 * declared on is not projected by it.
 */
export function Card({ card, size = 'md', canBuy, canReserve, onBuy, onReserve, onClick }: CardProps) {
  const effectiveColor: GemColor | null = card.assignedColor ?? card.color;
  const colorClass = effectiveColor ?? 'none';

  const cls = [
    styles.card,
    styles[`size-${size}`],
    styles[colorClass],
    onClick && styles.clickable,
    canBuy && canReserve ? styles.both : canBuy ? styles.affordable : canReserve ? styles.reservable : '',
  ].filter(Boolean).join(' ');

  const costEntries = TOKEN_COLORS
    .map(c => [c, card.cost[c] ?? 0] as [TokenColor, number])
    .filter(([, n]) => n > 0);

  const tokenSize = size === 'lg' ? 'md' : 'sm';

  return (
    <div className={styles.cardShell}>
      <div className={cls} onClick={onClick}>
        <div className={styles.body}>
          <div className={styles.header}>
            <span className={styles.points}>{card.points > 0 ? card.points : ''}</span>
            {card.crowns > 0 && <span className={styles.crowns}>👑{card.crowns}</span>}
          </div>

          <div className={styles.bonus}>
            {effectiveColor !== null && card.bonus > 0 && (
              Array.from({ length: card.bonus }).map((_, i) => (
                <Token key={i} color={effectiveColor} size={tokenSize} />
              ))
            )}
            {effectiveColor === null && <span className={styles.wildMark}>✦</span>}
          </div>

          {card.ability && (
            <div className={styles.ability}>{ABILITY_LABEL[card.ability] ?? card.ability}</div>
          )}

          <div className={styles.cost}>
            {costEntries.length === 0
              ? <span className={styles.costEmpty}>Free</span>
              : costEntries.map(([c, n]) => (
                  <Token key={c} color={c} size={tokenSize} count={n > 1 ? n : undefined} />
                ))
            }
          </div>
        </div>

        {(canBuy || canReserve) && (onBuy || onReserve) && (
          <div className={styles.actions} onClick={e => e.stopPropagation()}>
            {canBuy && onBuy && <button className="primary" onClick={onBuy}>Buy</button>}
            {canReserve && onReserve && <button onClick={onReserve}>Reserve</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Card-back (face-down deck) ──────────────────────────────────────────────

export interface CardBackProps {
  level: 1 | 2 | 3;
  remaining: number;
  canReserve?: boolean;
  onReserve?: () => void;
  size?: CardSize;
}

export function CardBack({ level, remaining, canReserve, onReserve, size = 'md' }: CardBackProps) {
  const cls = [
    styles.card,
    styles.back,
    styles[`size-${size}`],
    canReserve && styles.reservable,
  ].filter(Boolean).join(' ');

  return (
    <div className={`${styles.cardShell} ${styles.deckStack}`}>
      <div className={cls}>
        <div className={styles.backInner}>
          <span className={styles.backLevel}>{level}</span>
          {/* One pip per level: the deck's rank without relying on the numeral. */}
          <span className={styles.backPips}>
            {Array.from({ length: level }).map((_, i) => (
              <span key={i} className={styles.backPip} />
            ))}
          </span>
          <span className={styles.backCount}>{remaining} left</span>
        </div>
        {canReserve && onReserve && (
          <div className={styles.actions} onClick={e => e.stopPropagation()}>
            <button onClick={onReserve}>Reserve top</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Empty pyramid slot ─────────────────────────────────────────────────────

export function EmptyCardSlot({ size = 'md' }: { size?: CardSize }) {
  const cls = [styles.card, styles.empty, styles[`size-${size}`]].join(' ');
  return (
    <div className={styles.cardShell}>
      <div className={cls}>Empty</div>
    </div>
  );
}
