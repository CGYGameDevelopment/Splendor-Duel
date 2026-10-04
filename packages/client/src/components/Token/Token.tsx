import type { TokenColor } from '@splendor-duel/game-engine';
import { Gem } from '../Gem/Gem';
import styles from './Token.module.css';

/**
 * A physical token: a gem seated in a metal bezel.
 *
 * The artwork lives in <Gem>; this adds the chip around it, the interaction
 * states and the optional count badge. Tokens used to be flat circles stamped
 * with a letter (W/U/G/R/B/P), which read as a legend rather than a game piece
 * and forced players to learn an abbreviation per colour.
 */

const TOKEN_LABEL: Record<TokenColor, string> = {
  white: 'White gem',
  blue: 'Blue gem',
  green: 'Green gem',
  red: 'Red gem',
  black: 'Black gem',
  pearl: 'Pearl',
  gold: 'Gold',
};

export type TokenSize = 'sm' | 'md' | 'lg';

export interface TokenProps {
  color: TokenColor;
  size?: TokenSize;
  /** Optional badge with the count (used in player pools and card costs). */
  count?: number;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  title?: string;
}

const GEM_SIZE = { sm: 'sm', md: 'md', lg: 'lg' } as const;

export function Token({ color, size = 'md', count, selected, dimmed, onClick, title }: TokenProps) {
  const cls = [
    styles.token,
    styles[`size-${size}`],
    styles[color],
    onClick && styles.clickable,
    selected && styles.selected,
    dimmed && styles.dimmed,
  ].filter(Boolean).join(' ');

  const node = (
    <span
      className={cls}
      onClick={onClick}
      title={title ?? TOKEN_LABEL[color]}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      } : undefined}
    >
      <Gem color={color} size={GEM_SIZE[size]} label={TOKEN_LABEL[color]} />
    </span>
  );

  if (count !== undefined && count > 1) {
    return (
      <span className={styles.wrap}>
        {node}
        <span className={styles.badge}>{count}</span>
      </span>
    );
  }
  return node;
}
