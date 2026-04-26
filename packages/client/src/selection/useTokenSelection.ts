import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Action } from '@splendor-duel/game-engine';

type TakeTokensAction = Extract<Action, { type: 'TAKE_TOKENS' }>;

export interface TokenSelectionApi {
  /** Cells currently selected (in pick order). */
  selected: number[];
  /** Cells that, if added, would still form a legal TAKE_TOKENS line. */
  extendable: Set<number>;
  /** Cells that are currently selected OR extendable. (For dimming logic.) */
  highlightable: Set<number>;
  /** True if the current selection is itself a legal TAKE_TOKENS action. */
  canConfirm: boolean;
  /** Click handler — call from a Board cell. */
  onCellClick: (index: number) => void;
  clear: () => void;
  /** The TAKE_TOKENS action for the current selection, or null. */
  action: TakeTokensAction | null;
}

/**
 * Click-to-pick model for TAKE_TOKENS.
 *
 * Caller passes the pre-filtered list of legal TAKE_TOKENS actions for the
 * current state (or [] when not in mandatory phase / not the viewer's turn),
 * and a `resetKey` whose change indicates the legal-move space has shifted
 * meaningfully (e.g. phase change or current player flip). The selection is
 * cleared whenever resetKey changes — using only the state reference would
 * also reset on cosmetic STATE_UPDATEs that don't actually invalidate the
 * in-progress selection.
 *
 * Click rules:
 *  - Click a cell already selected → remove it (and any later picks).
 *  - Click an extendable cell → add it.
 *  - Click any other token cell with no current selection → start a fresh selection at that cell.
 *  - Click a non-extendable cell when a selection exists → ignored.
 */
export function useTokenSelection(
  tokenLines: readonly TakeTokensAction[],
  resetKey: string,
): TokenSelectionApi {
  const [selected, setSelected] = useState<number[]>([]);

  useEffect(() => {
    setSelected([]);
  }, [resetKey]);

  // Lines that match the current selection prefix (order-insensitive) AND have at least one extra index.
  const extendable = useMemo(() => {
    const set = new Set<number>();
    if (selected.length === 0) {
      for (const m of tokenLines) for (const i of m.indices) set.add(i);
      return set;
    }
    const selectedSet = new Set(selected);
    for (const m of tokenLines) {
      if (m.indices.length <= selected.length) continue;
      const indicesSet = new Set(m.indices);
      let isPrefix = true;
      for (const i of selected) if (!indicesSet.has(i)) { isPrefix = false; break; }
      if (!isPrefix) continue;
      for (const i of m.indices) if (!selectedSet.has(i)) set.add(i);
    }
    return set;
  }, [tokenLines, selected]);

  const highlightable = useMemo(() => {
    const s = new Set(extendable);
    for (const i of selected) s.add(i);
    return s;
  }, [extendable, selected]);

  const action = useMemo(() => {
    if (selected.length === 0) return null;
    const match = tokenLines.find(m => {
      if (m.indices.length !== selected.length) return false;
      const idxSet = new Set(m.indices);
      for (const i of selected) if (!idxSet.has(i)) return false;
      return true;
    });
    return match ?? null;
  }, [tokenLines, selected]);

  const canConfirm = action !== null;

  const onCellClick = useCallback((index: number) => {
    setSelected(prev => {
      if (prev.includes(index)) {
        const i = prev.indexOf(index);
        return prev.slice(0, i);
      }
      const candidate = [...prev, index];
      const isExtension = tokenLines.some(m => {
        if (m.indices.length < candidate.length) return false;
        const idxSet = new Set(m.indices);
        for (const i of candidate) if (!idxSet.has(i)) return false;
        return true;
      });
      if (isExtension) return candidate;
      const startsHere = tokenLines.some(m => m.indices.includes(index));
      return startsHere ? [index] : prev;
    });
  }, [tokenLines]);

  const clear = useCallback(() => setSelected([]), []);

  return { selected, extendable, highlightable, canConfirm, onCellClick, clear, action };
}
