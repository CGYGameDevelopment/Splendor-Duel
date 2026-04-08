import { reducer } from '../reducer';
import { createInitialState } from '../initialState';
import type { GameState, Card, PlayerState } from '../types';
import { emptyPool, totalPrivileges, totalTokensByColor, totalCardCount } from '../helpers';

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
    expect(totalPrivileges(next)).toBe(3);
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
    expect(totalPrivileges(next)).toBe(3);
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
    expect(next.extraTurns).toBe(1);
    expect(next.pendingAbility).toBeNull();
    expect(next.lastPurchasedCard).toBeNull();
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

    const next = reducer(s, { type: 'USE_PRIVILEGE', indices: [5] });
    expect(next.players[0].privileges).toBe(0);
    expect(next.players[0].tokens.green).toBe(1);
    expect(next.privileges).toBe(3);
    expect(totalPrivileges(next)).toBe(3);
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
    expect(totalPrivileges(next)).toBe(3);
  });
});

// ─── CARD ABILITY: Token ──────────────────────────────────────────────────────

describe('Token Ability', () => {
  test('Token ability takes matching color token from board', () => {
    const card = makeCard({ id: 100, ability: 'Token', color: 'red', cost: {} });
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[5] = 'red';
    const s: GameState = {
      ...state,
      board,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 100, goldUsage: {} });
    expect(next.phase).toBe('resolve_ability');
    expect(next.pendingAbility).toBe('Token');
    expect(next.lastPurchasedCard?.id).toBe(100);

    // Resolve the Token ability
    const resolved = reducer(next, { type: 'TAKE_TOKEN_FROM_BOARD', color: 'red' });
    expect(resolved.board[5]).toBeNull();
    expect(resolved.players[0].tokens.red).toBe(1);
    expect(resolved.pendingAbility).toBeNull();
    expect(resolved.phase).toBe('optional_privilege');
  });

  test('Token ability skipped if no matching token on board', () => {
    const card = makeCard({ id: 101, ability: 'Token', color: 'blue', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      board: new Array(25).fill(null),
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 101, goldUsage: {} });
    expect(next.pendingAbility).toBeNull();
    expect(next.phase).toBe('optional_privilege');
  });

  test('Token ability on joker card is skipped', () => {
    const card = makeCard({ id: 102, ability: 'Token', color: 'joker', cost: {} });
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[5] = 'red';
    const s: GameState = {
      ...state,
      board,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 102, goldUsage: {} });
    expect(next.pendingAbility).toBeNull();
    expect(next.phase).toBe('optional_privilege');
  });
});

// ─── CARD ABILITY: Take ───────────────────────────────────────────────────────

describe('Take Ability', () => {
  test('Take ability lets player steal gem token from opponent', () => {
    const card = makeCard({ id: 103, ability: 'Take', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [
        makePlayer(),
        makePlayer({ tokens: { ...emptyPool(), green: 2 } }),
      ],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 103, goldUsage: {} });
    expect(next.phase).toBe('resolve_ability');
    expect(next.pendingAbility).toBe('Take');

    // Resolve Take ability
    const resolved = reducer(next, { type: 'TAKE_TOKEN_FROM_OPPONENT', color: 'green' });
    expect(resolved.players[0].tokens.green).toBe(1);
    expect(resolved.players[1].tokens.green).toBe(1);
    expect(resolved.pendingAbility).toBeNull();
  });

  test('Take ability skipped if opponent has no eligible tokens', () => {
    const card = makeCard({ id: 104, ability: 'Take', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [
        makePlayer(),
        makePlayer({ tokens: { ...emptyPool(), gold: 5 } }),
      ],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 104, goldUsage: {} });
    expect(next.pendingAbility).toBeNull();
    expect(next.phase).toBe('optional_privilege');
  });

  test('Take ability rejects gold token', () => {
    const card = makeCard({ id: 105, ability: 'Take', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [
        makePlayer(),
        makePlayer({ tokens: { ...emptyPool(), gold: 5 } }),
      ],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 105, goldUsage: {} });
    // Even though opponent has gold, Take ability is skipped (no non-gold tokens)
    expect(next.pendingAbility).toBeNull();
  });
});

// ─── CARD ABILITY: Privilege ──────────────────────────────────────────────────

describe('Privilege Ability', () => {
  test('Privilege ability grants 1 privilege to current player', () => {
    const card = makeCard({ id: 106, ability: 'Privilege', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      privileges: 3,
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 106, goldUsage: {} });
    expect(next.players[0].privileges).toBe(1);
    expect(next.privileges).toBe(2);
    expect(next.phase).toBe('optional_privilege');
    expect(totalPrivileges(next)).toBe(3);
  });

  test('Privilege ability capped at 3 total (exhaust privilege)', () => {
    const card = makeCard({ id: 107, ability: 'Privilege', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      privileges: 0,
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [
        makePlayer({ privileges: 3 }),
        makePlayer(),
      ],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 107, goldUsage: {} });
    // Player already has 3 privileges; cannot take more
    expect(next.players[0].privileges).toBe(3);
    expect(next.privileges).toBe(0);
    expect(totalPrivileges(next)).toBe(3);
  });
});

// ─── CARD ABILITY: Bonus ──────────────────────────────────────────────────────

describe('Bonus Ability', () => {
  test('Bonus card requires placement on eligible purchased card', () => {
    const bonusCard = makeCard({ id: 110, ability: 'Bonus', color: 'joker', cost: {} });
    const targetCard = makeCard({ id: 111, color: 'red', bonus: 1 });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [bonusCard, ...state.pyramid.level1.slice(0, 4)] },
      players: [
        makePlayer({ purchasedCards: [targetCard] }),
        makePlayer(),
      ],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 110, goldUsage: {} });
    expect(next.phase).toBe('place_bonus');
    expect(next.pendingAbility).toBe('Bonus');

    const resolved = reducer(next, { type: 'PLACE_BONUS_CARD', bonusCardId: 110, targetCardId: 111 });
    expect(resolved.players[0].purchasedCards[1].overlappingCardId).toBe(111);
    expect(resolved.players[0].purchasedCards[1].assignedColor).toBe('red');
    expect(resolved.pendingAbility).toBeNull();
  });

  test('Bonus card ability skipped if no eligible targets', () => {
    const bonusCard = makeCard({ id: 112, ability: 'Bonus', color: 'joker', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [bonusCard, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer({ purchasedCards: [] }), makePlayer()],
    };

    // Purchase succeeds, but ability is skipped (no eligible cards to place on)
    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 112, goldUsage: {} });
    expect(next.players[0].purchasedCards.some(c => c.id === 112)).toBe(true);
    expect(next.phase).toBe('optional_privilege');
    expect(next.pendingAbility).toBeNull();
  });

  test('Bonus card requires eligible target (must have bonus and no overlap)', () => {
    const bonusCard1 = makeCard({ id: 113, ability: 'Bonus', color: 'joker' });
    const bonusCard2 = makeCard({ id: 114, ability: 'Bonus', color: 'joker' });
    const bonusCard3 = makeCard({ id: 200, ability: 'Bonus', color: 'joker' });
    const noBonus = makeCard({ id: 116, color: 'blue', bonus: 0 });

    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [bonusCard3, ...state.pyramid.level1.slice(0, 4)] },
      players: [
        makePlayer({
          purchasedCards: [
            noBonus,  // no bonus, ineligible
            { ...bonusCard1, assignedColor: 'red', overlappingCardId: 999 },  // already has overlap, ineligible
            { ...bonusCard2, assignedColor: 'blue', overlappingCardId: 998 },  // already has overlap, ineligible
          ],
        }),
        makePlayer(),
      ],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 200, goldUsage: {} });
    // Purchase succeeds, but ability is skipped (no eligible target cards)
    expect(next.players[0].purchasedCards.some(c => c.id === 200)).toBe(true);
    expect(next.phase).toBe('optional_privilege');
  });
});

// ─── CARD ABILITY: Bonus/Turn ─────────────────────────────────────────────────

describe('Bonus/Turn Ability', () => {
  test('Bonus/Turn places bonus card and grants extra turn (consumed immediately in endTurn)', () => {
    const bonusCard = makeCard({ id: 120, ability: 'Bonus/Turn', color: 'joker', cost: {} });
    const targetCard = makeCard({ id: 121, color: 'green', bonus: 1 });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [bonusCard, ...state.pyramid.level1.slice(0, 4)] },
      players: [
        makePlayer({ purchasedCards: [targetCard] }),
        makePlayer(),
      ],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 120, goldUsage: {} });
    expect(next.phase).toBe('place_bonus');

    const resolved = reducer(next, { type: 'PLACE_BONUS_CARD', bonusCardId: 120, targetCardId: 121 });
    // Bonus/Turn increments extraTurns then calls endTurn, which immediately decrements it
    // Result: player continues their turn in optional_privilege phase
    expect(resolved.extraTurns).toBe(0);
    expect(resolved.currentPlayer).toBe(0);
    expect(resolved.phase).toBe('optional_privilege');
  });
});

// ─── CARD ABILITY: Turn (chaining) ────────────────────────────────────────────

describe('Turn Ability Chaining', () => {
  test('Turn ability grants extra turn on same player', () => {
    const turnCard = makeCard({ id: 130, ability: 'Turn', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [turnCard, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 130, goldUsage: {} });
    expect(next.extraTurns).toBe(1);
    expect(next.currentPlayer).toBe(0);
    expect(next.phase).toBe('mandatory');
  });

  test('Turn abilities can chain (buying Turn during extra turn)', () => {
    const turnCard1 = makeCard({ id: 131, ability: 'Turn', cost: {} });
    const turnCard2 = makeCard({ id: 132, ability: 'Turn', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      extraTurns: 1,
      pyramid: { ...state.pyramid, level1: [turnCard1, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };

    // First Turn card during extra turn increments the queue
    const next1 = reducer(s, { type: 'PURCHASE_CARD', cardId: 131, goldUsage: {} });
    expect(next1.extraTurns).toBe(2); // 1 (existing) + 1 (from Turn ability)
    expect(next1.phase).toBe('mandatory');

    // Second Turn card further increments the queue
    const next2: GameState = { ...next1, phase: 'mandatory', pyramid: { ...next1.pyramid, level1: [turnCard2, ...next1.pyramid.level1.slice(0, 4)] } };
    const next3 = reducer(next2, { type: 'PURCHASE_CARD', cardId: 132, goldUsage: {} });
    expect(next3.extraTurns).toBe(3);
  });
});

// ─── CARD ABILITY: Royal Cards ────────────────────────────────────────────────

describe('Royal Card Abilities', () => {
  test('Reaching 3 crowns awards royal card with Privilege ability', () => {
    const card = makeCard({ id: 140, crowns: 3, cost: {} });
    const royalCard = makeCard({ id: 200, level: 'royal', ability: 'Privilege', points: 3, cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      privileges: 3,
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      royalDeck: [royalCard],
      players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 140, goldUsage: {} });
    expect(next.players[0].royalCards).toHaveLength(1);
    expect(next.players[0].privileges).toBe(1);
    expect(next.privileges).toBe(2);
    expect(totalPrivileges(next)).toBe(3);
  });

  test('Reaching 6 crowns awards another royal card', () => {
    const card = makeCard({ id: 141, crowns: 4, cost: {} });
    const royalCard = makeCard({ id: 201, level: 'royal', points: 5, cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      royalDeck: [royalCard],
      players: [
        makePlayer({ crowns: 2 }),
        makePlayer(),
      ],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 141, goldUsage: {} });
    expect(next.players[0].royalCards).toHaveLength(1);
    expect(next.players[0].crowns).toBe(6);
  });

  test('Royal card with Token ability takes from board immediately', () => {
    const card = makeCard({ id: 142, crowns: 3, cost: {} });
    const royalCard = makeCard({ id: 202, level: 'royal', ability: 'Token', color: 'black', points: 3, cost: {} });
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[5] = 'black';
    const s: GameState = {
      ...state,
      board,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      royalDeck: [royalCard],
      players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 142, goldUsage: {} });
    expect(next.board[5]).toBeNull();
    expect(next.players[0].tokens.black).toBe(1);
  });
});

// ─── Full Game Flow: Multi-ability sequence ────────────────────────────────────

describe('Multi-ability Sequences', () => {
  test('Purchase card with Turn, then another card with ability in extra turn', () => {
    const turnCard = makeCard({ id: 150, ability: 'Turn', cost: {} });
    const privilegeCard = makeCard({ id: 151, ability: 'Privilege', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      privileges: 3,
      pyramid: { ...state.pyramid, level1: [turnCard, ...state.pyramid.level1.slice(0, 4)] },
      players: [
        makePlayer(),
        makePlayer(),
      ],
    };

    // Buy Turn card
    const next1 = reducer(s, { type: 'PURCHASE_CARD', cardId: 150, goldUsage: {} });
    expect(next1.extraTurns).toBe(1);
    expect(next1.phase).toBe('mandatory');

    // Simulate second mandatory phase with Privilege card available
    const next2 = {
      ...next1,
      pyramid: { ...next1.pyramid, level1: [privilegeCard, ...next1.pyramid.level1.slice(1)] },
    };
    const next3 = reducer(next2, { type: 'PURCHASE_CARD', cardId: 151, goldUsage: {} });
    expect(next3.players[0].privileges).toBe(1);
    expect(next3.extraTurns).toBe(0);
    expect(totalPrivileges(next3)).toBe(3);
  });
});

// ─── Conservation Invariants ──────────────────────────────────────────────────
// For each action, verify that tokens and cards are conserved across all zones.

describe('Conservation Invariants', () => {
  /** Asserts token counts per color are unchanged vs baseline, and card counts are unchanged. */
  function assertConserved(before: GameState, after: GameState) {
    const tokBefore = totalTokensByColor(before);
    const tokAfter  = totalTokensByColor(after);
    expect(tokAfter).toEqual(tokBefore);

    const cardsBefore = totalCardCount(before);
    const cardsAfter  = totalCardCount(after);
    expect(cardsAfter).toEqual(cardsBefore);
  }

  test('TAKE_TOKENS conserves tokens', () => {
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[0] = 'black'; board[1] = 'red'; board[2] = 'green';
    const s: GameState = { ...state, board, phase: 'mandatory', players: [makePlayer(), makePlayer()] };
    const next = reducer(s, { type: 'TAKE_TOKENS', indices: [0, 1, 2] });
    assertConserved(s, next);
  });

  test('TAKE_TOKENS penalty (3 same color) conserves tokens', () => {
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[0] = 'red'; board[1] = 'red'; board[2] = 'red';
    const s: GameState = {
      ...state, board, phase: 'mandatory',
      privileges: 3, players: [makePlayer(), makePlayer()],
    };
    const next = reducer(s, { type: 'TAKE_TOKENS', indices: [0, 1, 2] });
    assertConserved(s, next);
  });

  test('RESERVE_CARD_FROM_PYRAMID conserves tokens and cards', () => {
    const card = makeCard({ id: 60 });
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[12] = 'gold';
    const s: GameState = {
      ...state, board, phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };
    const next = reducer(s, { type: 'RESERVE_CARD_FROM_PYRAMID', cardId: 60 });
    assertConserved(s, next);
  });

  test('RESERVE_CARD (from deck) conserves tokens and cards', () => {
    const deckCard = makeCard({ id: 70 });
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[12] = 'gold';
    const s: GameState = {
      ...state, board, phase: 'mandatory',
      decks: { ...state.decks, level1: [deckCard, ...state.decks.level1] },
      players: [makePlayer(), makePlayer()],
    };
    const next = reducer(s, { type: 'RESERVE_CARD', source: 'deck_1' });
    assertConserved(s, next);
  });

  test('PURCHASE_CARD conserves tokens and cards', () => {
    const card = makeCard({ id: 80, cost: { black: 2 } });
    const state = createInitialState(false);
    const s: GameState = {
      ...state, phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer({ tokens: { ...emptyPool(), black: 2 } }), makePlayer()],
    };
    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 80, goldUsage: {} });
    assertConserved(s, next);
  });

  test('PURCHASE_CARD with gold usage conserves tokens and cards', () => {
    const card = makeCard({ id: 81, cost: { black: 3 } });
    const state = createInitialState(false);
    const s: GameState = {
      ...state, phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer({ tokens: { ...emptyPool(), black: 2, gold: 1 } }), makePlayer()],
    };
    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 81, goldUsage: { black: 1 } });
    assertConserved(s, next);
  });

  test('USE_PRIVILEGE conserves tokens', () => {
    const board = new Array(25).fill(null);
    board[5] = 'green';
    const state = createInitialState(false);
    const s: GameState = {
      ...state, board, phase: 'optional_privilege', privileges: 2,
      players: [makePlayer({ privileges: 1 }), makePlayer()],
    };
    const next = reducer(s, { type: 'USE_PRIVILEGE', indices: [5] });
    assertConserved(s, next);
  });

  test('REPLENISH_BOARD conserves tokens', () => {
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
    assertConserved(s, next);
  });

  test('DISCARD_TOKENS conserves tokens', () => {
    const state = createInitialState(false);
    const s: GameState = {
      ...state, phase: 'discard',
      players: [makePlayer({ tokens: { ...emptyPool(), black: 11 } }), makePlayer()],
    };
    const next = reducer(s, { type: 'DISCARD_TOKENS', tokens: { black: 1 } });
    assertConserved(s, next);
  });

  test('TAKE_TOKEN_FROM_BOARD (Token ability) conserves tokens', () => {
    const card = makeCard({ id: 100, ability: 'Token', color: 'red', cost: {} });
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[5] = 'red';
    const s: GameState = {
      ...state, board, phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };
    const afterPurchase = reducer(s, { type: 'PURCHASE_CARD', cardId: 100, goldUsage: {} });
    const afterAbility  = reducer(afterPurchase, { type: 'TAKE_TOKEN_FROM_BOARD', color: 'red' });
    assertConserved(s, afterAbility);
  });

  test('TAKE_TOKEN_FROM_OPPONENT (Take ability) conserves tokens', () => {
    const card = makeCard({ id: 103, ability: 'Take', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state, phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer({ tokens: { ...emptyPool(), green: 2 } })],
    };
    const afterPurchase = reducer(s, { type: 'PURCHASE_CARD', cardId: 103, goldUsage: {} });
    const afterAbility  = reducer(afterPurchase, { type: 'TAKE_TOKEN_FROM_OPPONENT', color: 'green' });
    assertConserved(s, afterAbility);
  });

  test('Crown milestone (royal card awarded) conserves cards', () => {
    const card = makeCard({ id: 140, crowns: 3, cost: {} });
    const royalCard = makeCard({ id: 200, level: 'royal', points: 3, cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state, phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      royalDeck: [royalCard],
      players: [makePlayer(), makePlayer()],
    };
    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 140, goldUsage: {} });
    assertConserved(s, next);
  });
});
