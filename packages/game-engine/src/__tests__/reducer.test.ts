import { reducer } from '../reducer';
import { createInitialState } from '../initialState';
import type { GameState, Card, PlayerState } from '../types';
import { emptyPool } from '../helpers';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 99, level: 1, color: 'black', points: 0, bonus: 1,
    ability: null, crowns: 0, cost: {}, assignedColor: null, overlappingCardId: null,
    ...overrides,
  };
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    tokens: emptyPool(), purchasedCards: [], reservedCards: [],
    privileges: 0, crowns: 0, prestige: 0, royalCards: [],
    ...overrides,
  };
}

// ─── TAKE_TOKENS ──────────────────────────────────────────────────────────────

describe('TAKE_TOKENS', () => {
  test('taking 1 token moves it from board to player', () => {
    const state = createInitialState(false);
    // Force a known token at index 12 (center)
    const board = [...state.board];
    board[12] = 'black';
    const s: GameState = { ...state, board, phase: 'mandatory' };

    const next = reducer(s, { type: 'TAKE_TOKENS', indices: [12] });
    expect(next.board[12]).toBeNull();
    expect(next.players[0].tokens.black).toBe(1);
  });

  test('taking 3 same color grants opponent a privilege', () => {
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[0] = 'red'; board[1] = 'red'; board[2] = 'red';
    const s: GameState = {
      ...state, board, phase: 'mandatory',
      privileges: 3, players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'TAKE_TOKENS', indices: [0, 1, 2] });
    expect(next.players[1].privileges).toBe(1);
  });

  test('taking 2 pearls grants opponent a privilege', () => {
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[0] = 'pearl'; board[1] = 'pearl';
    const s: GameState = {
      ...state, board, phase: 'mandatory',
      privileges: 3, players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'TAKE_TOKENS', indices: [0, 1] });
    expect(next.players[1].privileges).toBe(1);
  });

  test('non-line selection is rejected', () => {
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[0] = 'blue'; board[2] = 'blue'; // gap — not adjacent
    const s: GameState = { ...state, board, phase: 'mandatory' };
    const next = reducer(s, { type: 'TAKE_TOKENS', indices: [0, 2] });
    expect(next).toBe(s); // state unchanged
  });

  test('cannot take gold', () => {
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[12] = 'gold';
    const s: GameState = { ...state, board, phase: 'mandatory' };
    const next = reducer(s, { type: 'TAKE_TOKENS', indices: [12] });
    expect(next).toBe(s);
  });
});

// ─── PURCHASE_CARD ────────────────────────────────────────────────────────────

describe('PURCHASE_CARD', () => {
  test('purchasing a card deducts tokens and adds card to player', () => {
    const card = makeCard({ id: 50, color: 'black', points: 2, cost: { black: 2 } });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [
        makePlayer({ tokens: { ...emptyPool(), black: 2 } }),
        makePlayer(),
      ],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 50, goldUsage: {} });
    expect(next.players[0].purchasedCards.some(c => c.id === 50)).toBe(true);
    expect(next.players[0].tokens.black).toBe(0);
    expect(next.players[0].prestige).toBe(2);
  });

  test('cannot purchase card you cannot afford', () => {
    const card = makeCard({ id: 51, cost: { black: 5 } });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer({ tokens: { ...emptyPool(), black: 2 } }), makePlayer()],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 51, goldUsage: {} });
    expect(next).toBe(s);
  });

  test('Turn ability queues an extra turn', () => {
    const card = makeCard({ id: 52, ability: 'Turn', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 52, goldUsage: {} });
    // Turn cards resolve immediately and grant another mandatory phase on same player's turn
    expect(next.currentPlayer).toBe(0);
    expect(next.phase).toBe('mandatory');
  });

  test('crown milestone grants royal card at 3 crowns', () => {
    const card = makeCard({ id: 53, crowns: 3, cost: {} });
    const royalCard = makeCard({ id: 200, level: 'royal', points: 3, cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      royalDeck: [royalCard],
      players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 53, goldUsage: {} });
    expect(next.players[0].royalCards).toHaveLength(1);
    expect(next.players[0].royalCards[0].id).toBe(200);
    expect(next.royalDeck).toHaveLength(0);
  });
});

// ─── RESERVE_CARD ─────────────────────────────────────────────────────────────

describe('RESERVE_CARD_FROM_PYRAMID', () => {
  test('reserves card, takes gold from board, card removed from pyramid', () => {
    const card = makeCard({ id: 60 });
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[12] = 'gold';
    const s: GameState = {
      ...state,
      board,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'RESERVE_CARD_FROM_PYRAMID', cardId: 60 });
    expect(next.players[0].reservedCards).toHaveLength(1);
    expect(next.players[0].tokens.gold).toBe(1);
    expect(next.board[12]).toBeNull();
  });

  test('cannot reserve if already have 3 reserved', () => {
    const cards = [60, 61, 62].map(id => makeCard({ id }));
    const newCard = makeCard({ id: 63 });
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[12] = 'gold';
    const s: GameState = {
      ...state, board, phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [newCard, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer({ reservedCards: cards }), makePlayer()],
    };

    const next = reducer(s, { type: 'RESERVE_CARD_FROM_PYRAMID', cardId: 63 });
    expect(next).toBe(s);
  });
});

// ─── USE_PRIVILEGE ────────────────────────────────────────────────────────────

describe('USE_PRIVILEGE', () => {
  test('returns privilege to table and takes token from board', () => {
    const board = new Array(25).fill(null);
    board[5] = 'green';
    const state = createInitialState(false);
    const s: GameState = {
      ...state, board, phase: 'optional_privilege', privileges: 2,
      players: [makePlayer({ privileges: 1 }), makePlayer()],
    };

    const next = reducer(s, { type: 'USE_PRIVILEGE', tokens: { green: 1 } });
    expect(next.players[0].privileges).toBe(0);
    expect(next.players[0].tokens.green).toBe(1);
    expect(next.privileges).toBe(3);
  });
});

// ─── DISCARD ──────────────────────────────────────────────────────────────────

describe('DISCARD_TOKENS', () => {
  test('discards tokens and moves to next player', () => {
    const state = createInitialState(false);
    const s: GameState = {
      ...state, phase: 'discard',
      players: [
        makePlayer({ tokens: { ...emptyPool(), black: 11 } }),
        makePlayer(),
      ],
    };

    const next = reducer(s, { type: 'DISCARD_TOKENS', tokens: { black: 1 } });
    expect(next.players[0].tokens.black).toBe(10);
    expect(next.currentPlayer).toBe(1);
  });

  test('rejected if still over 10 after discard', () => {
    const state = createInitialState(false);
    const s: GameState = {
      ...state, phase: 'discard',
      players: [makePlayer({ tokens: { ...emptyPool(), black: 12 } }), makePlayer()],
    };

    const next = reducer(s, { type: 'DISCARD_TOKENS', tokens: { black: 1 } });
    expect(next).toBe(s);
  });
});

// ─── REPLENISH_BOARD ──────────────────────────────────────────────────────────

describe('REPLENISH_BOARD', () => {
  test('fills empty board cells from bag and gives opponent a privilege', () => {
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      board: new Array(25).fill(null),
      bag: { ...emptyPool(), black: 5 },
      phase: 'optional_replenish',
      privileges: 3,
      players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'REPLENISH_BOARD' });
    const filled = next.board.filter(c => c !== null).length;
    expect(filled).toBe(5);
    expect(next.players[1].privileges).toBe(1);
    expect(next.phase).toBe('mandatory');
  });
});
