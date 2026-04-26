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
  Turn: '↻ Extra Turn',
  Token: '+ Token',
  Take: '✋ Take',
  Privilege: '📜 Privilege',
  wild: '✦ Wild',
  'wild and turn': '✦ Wild + ↻',
};

export function Card({ card, size = 'md', canBuy, canReserve, onBuy, onReserve, onClick }: CardProps) {
  const effectiveColor: GemColor | null = card.assignedColor ?? card.color;
  const colorClass = effectiveColor ?? 'none';

  const cls = [
    styles.card,
    styles[`size-${size}` as `size-${CardSize}`],
    onClick && styles.clickable,
    canBuy && canReserve ? styles.both : canBuy ? styles.affordable : canReserve ? styles.reservable : '',
  ].filter(Boolean).join(' ');

  const costEntries = TOKEN_COLORS
    .map(c => [c, card.cost[c] ?? 0] as [TokenColor, number])
    .filter(([, n]) => n > 0);

  return (
    <div className={cls} onClick={onClick}>
      <div className={`${styles.colorBar} ${styles[colorClass]}`} />
      <div className={styles.header}>
        <span className={styles.points}>{card.points > 0 ? card.points : ''}</span>
        <span className={styles.crowns}>{card.crowns > 0 ? `👑${card.crowns}` : ''}</span>
      </div>
      <div className={styles.bonus}>
        {effectiveColor !== null && card.bonus > 0 && (
          Array.from({ length: card.bonus }).map((_, i) => (
            <Token key={i} color={effectiveColor as TokenColor} size="sm" />
          ))
        )}
        {effectiveColor === null && (
          <span style={{ fontSize: 16, color: 'var(--accent)' }}>✦</span>
        )}
      </div>
      {card.ability && (
        <div className={styles.ability}>{ABILITY_LABEL[card.ability] ?? card.ability}</div>
      )}
      <div className={styles.cost}>
        {costEntries.length === 0
          ? <span className={styles.costEmpty}>free</span>
          : costEntries.map(([c, n]) => (
              <Token key={c} color={c} size="sm" count={n > 1 ? n : undefined} />
            ))
        }
      </div>
      {(canBuy || canReserve) && (onBuy || onReserve) && (
        <div className={styles.actions} onClick={e => e.stopPropagation()}>
          {canBuy && onBuy && (
            <button className="primary" onClick={onBuy}>Buy</button>
          )}
          {canReserve && onReserve && (
            <button onClick={onReserve}>Reserve</button>
          )}
        </div>
      )}
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
    styles[`size-${size}` as `size-${CardSize}`],
    canReserve && styles.reservable,
  ].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <div className={styles.backLabel}>L{level}</div>
      <div className={styles.backCount}>{remaining} left</div>
      {canReserve && onReserve && (
        <div className={styles.actions} onClick={e => e.stopPropagation()}>
          <button onClick={onReserve}>Reserve top</button>
        </div>
      )}
    </div>
  );
}

// ─── Empty pyramid slot ─────────────────────────────────────────────────────

export function EmptyCardSlot({ size = 'md' }: { size?: CardSize }) {
  const cls = [
    styles.card,
    styles.empty,
    styles[`size-${size}` as `size-${CardSize}`],
  ].filter(Boolean).join(' ');
  return <div className={cls}>(empty)</div>;
}
