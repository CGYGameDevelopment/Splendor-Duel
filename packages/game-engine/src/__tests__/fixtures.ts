import type { Card, PlayerState } from '../types';
import { emptyPool } from '../helpers';

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
