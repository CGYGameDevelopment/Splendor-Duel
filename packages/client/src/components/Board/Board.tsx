import type { Board as BoardType, TokenColor } from '@splendor-duel/game-engine';
import { Token } from '../Token/Token';
import styles from './Board.module.css';

export type CellMode = 'normal' | 'highlight' | 'dimmed';

export interface BoardProps {
  board: BoardType;
  /** Cells that are part of the active selection (rendered with selected style on the token). */
  selected?: Set<number>;
  /** Cells that are interactive (clickable). Pass undefined to disable all clicks. */
  clickable?: Set<number>;
  /** Cells that are dimmed (un-selectable / not in the legal selection space). */
  dimmed?: Set<number>;
  onCellClick?: (index: number) => void;
}

export function Board({ board, selected, clickable, dimmed, onCellClick }: BoardProps) {
  return (
    <div className={styles.boardWrap}>
      <div className={styles.board}>
        {board.map((cell, idx) => {
          const isSelected = selected?.has(idx) ?? false;
          const isDimmed = dimmed?.has(idx) ?? false;
          const isClickable = clickable?.has(idx) ?? false;

          const cellCls = [
            styles.cell,
            isSelected && styles.highlight,
            isDimmed && styles.dimmed,
          ].filter(Boolean).join(' ');

          return (
            <div key={idx} className={cellCls}>
              <span className={styles.indexHint}>{idx}</span>
              {cell ? (
                <Token
                  color={cell as TokenColor}
                  size="md"
                  selected={isSelected}
                  onClick={isClickable && onCellClick ? () => onCellClick(idx) : undefined}
                />
              ) : (
                <span className={styles.empty}>·</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
