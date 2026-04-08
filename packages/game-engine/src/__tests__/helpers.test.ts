import { netCost, canAfford, checkVictory, playerBonuses, totalTokens, emptyPool } from '../helpers';
import type { Card, PlayerState } from '../types';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 1, level: 1, color: 'black', points: 0, bonus: 1,
    ability: null, crowns: 0, cost: {}, assignedColor: null, overlappingCardId: null,
    ...overrides,
  };
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
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

describe('netCost', () => {
  test('no bonuses — returns full cost', () => {
    const card = makeCard({ cost: { black: 2, red: 3 } });
    const player = makePlayer();
    expect(netCost(card, player)).toEqual({ black: 2, red: 3 });
  });

  test('bonus reduces cost, floor at 0', () => {
    const card = makeCard({ cost: { black: 2, red: 3 } });
    const purchased = makeCard({ id: 2, color: 'black', bonus: 2, cost: {} });
    const player = makePlayer({ purchasedCards: [purchased] });
    // 2 black bonuses covers all 2 black cost
    expect(netCost(card, player)).toEqual({ red: 3 });
  });

  test('excess bonus does not go negative', () => {
    const card = makeCard({ cost: { blue: 1 } });
    const purchased = makeCard({ id: 2, color: 'blue', bonus: 3, cost: {} });
    const player = makePlayer({ purchasedCards: [purchased] });
    expect(netCost(card, player)).toEqual({});
  });
});

describe('canAfford', () => {
  test('player with exact tokens can afford', () => {
    const card = makeCard({ cost: { black: 2 } });
    const player = makePlayer({ tokens: { ...emptyPool(), black: 2 } });
    expect(canAfford(card, player)).toBe(true);
  });

  test('player without enough tokens cannot afford', () => {
    const card = makeCard({ cost: { black: 3 } });
    const player = makePlayer({ tokens: { ...emptyPool(), black: 2 } });
    expect(canAfford(card, player)).toBe(false);
  });

  test('gold fills the gap', () => {
    const card = makeCard({ cost: { black: 3 } });
    const player = makePlayer({ tokens: { ...emptyPool(), black: 2, gold: 1 } });
    expect(canAfford(card, player, { black: 1 })).toBe(true);
  });

  test('cannot afford if gold allocation exceeds gold held', () => {
    const card = makeCard({ cost: { black: 3 } });
    const player = makePlayer({ tokens: { ...emptyPool(), black: 2, gold: 0 } });
    expect(canAfford(card, player, { black: 1 })).toBe(false);
  });
});

describe('checkVictory', () => {
  test('prestige win at 20', () => {
    const player = makePlayer({ prestige: 20 });
    expect(checkVictory(player)).toBe('prestige');
  });

  test('no win below 20 prestige', () => {
    const player = makePlayer({ prestige: 19 });
    expect(checkVictory(player)).toBeNull();
  });

  test('crowns win at 10', () => {
    const player = makePlayer({ crowns: 10 });
    expect(checkVictory(player)).toBe('crowns');
  });

  test('color prestige win — 10 points of same color', () => {
    const cards = [
      makeCard({ id: 1, color: 'red', points: 5 }),
      makeCard({ id: 2, color: 'red', points: 5 }),
    ];
    const player = makePlayer({ purchasedCards: cards });
    expect(checkVictory(player)).toBe('color_prestige');
  });

  test('color prestige — joker uses assignedColor', () => {
    const redCard = makeCard({ id: 1, color: 'red', points: 7 });
    const jokerCard = makeCard({ id: 2, color: 'joker', points: 3, assignedColor: 'red' });
    const player = makePlayer({ purchasedCards: [redCard, jokerCard] });
    expect(checkVictory(player)).toBe('color_prestige');
  });
});

describe('totalTokens', () => {
  test('sums all token counts', () => {
    const pool = { ...emptyPool(), black: 3, gold: 2, pearl: 1 };
    expect(totalTokens(pool)).toBe(6);
  });
});
