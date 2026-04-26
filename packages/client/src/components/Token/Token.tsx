import type { TokenColor } from '@splendor-duel/game-engine';
import styles from './Token.module.css';

const ABBR: Record<TokenColor, string> = {
  white: 'W',
  blue: 'U',
  green: 'G',
  red: 'R',
  black: 'B',
  pearl: 'P',
  gold: '★',
};

export type TokenSize = 'sm' | 'md' | 'lg';

export interface TokenProps {
  color: TokenColor;
  size?: TokenSize;
  count?: number;          // optional badge with the count (used in player pools)
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  title?: string;
}

export function Token({ color, size = 'md', count, selected, dimmed, onClick, title }: TokenProps) {
  const cls = [
    styles.token,
    styles[`size-${size}` as `size-${TokenSize}`],
    styles[color],
    onClick && styles.clickable,
    selected && styles.selected,
    dimmed && styles.dimmed,
  ].filter(Boolean).join(' ');

  const node = (
    <span className={cls} onClick={onClick} title={title} role={onClick ? 'button' : undefined}>
      {ABBR[color]}
    </span>
  );

  if (count !== undefined && count > 1) {
    return (
      <span className={styles.wrap}>
        {node}
        <span className={styles.badge}>×{count}</span>
      </span>
    );
  }
  return node;
}
