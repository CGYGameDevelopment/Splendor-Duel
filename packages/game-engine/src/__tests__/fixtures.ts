import type { Card, GameState, PlayerState } from '../types';
import { emptyPool, BOARD_SIZE } from '../helpers';

export function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 99, level: 1, color: 'black', points: 0, bonus: 1,
    ability: null, crowns: 0, cost: {}, assignedColor: null,
    ...overrides,
  };
}

export function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    tokens: emptyPool(),
    purchasedCards: [],
    reservedCards: [],
    privileges: 0,
    crowns: 0,
    prestige: 0,
    royalCards: [],
    ...overrides,
  };
}

/**
 * A state in which the current player genuinely has no mandatory action
 * available, which is the only situation where PASS_MANDATORY is legal.
 *
 * Deadlock needs all four sources of mandatory moves to be dry: no tokens on the
 * board (nothing to take), no gold on the board and no deck cards (nothing to
 * reserve), no purchasable card (empty pyramid), and an empty bag (nothing to
 * replenish, which would otherwise be forced first).
 */
export function deadlockedMandatoryState(state: GameState, overrides: Partial<GameState> = {}): GameState {
  return {
    ...state,
    phase: 'mandatory',
    board: new Array(BOARD_SIZE).fill(null),
    bag: emptyPool(),
    pyramid: { level1: [], level2: [], level3: [] },
    decks: { level1: [], level2: [], level3: [] },
    ...overrides,
  };
}
