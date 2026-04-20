import { reducer } from '../reducer';
import { createInitialState } from '../initialState';
import type { GameState } from '../types';
import { emptyPool, totalPrivileges, totalTokensByColor, totalCardCount } from '../helpers';
import { makeCard, makePlayer } from './fixtures';

// ─── TAKE_TOKENS ──────────────────────────────────────────────────────────────

describe('TAKE_TOKENS', () => {
  it('moves a taken token from the board to the current player', () => {
    const state = createInitialState(false);
    const board = [...state.board];
    board[12] = 'black';
    const s: GameState = { ...state, board, phase: 'mandatory' };

    const next = reducer(s, { type: 'TAKE_TOKENS', indices: [12] });
    expect(next.board[12]).toBeNull();
    expect(next.players[0].tokens.black).toBe(1);
  });

  it('grants the opponent a privilege when 3 identical-color tokens are taken', () => {
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

  it('grants the opponent a privilege when 2 pearls are taken', () => {
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

  it('grants the opponent a privilege when 2 pearls are taken alongside a third token', () => {
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[0] = 'pearl'; board[1] = 'pearl'; board[2] = 'red';
    const s: GameState = {
      ...state, board, phase: 'mandatory',
      privileges: 3, players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'TAKE_TOKENS', indices: [0, 1, 2] });
    expect(next.players[1].privileges).toBe(1);
    expect(totalPrivileges(next)).toBe(3);
  });

  it('rejects a non-line selection and returns state unchanged', () => {
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[0] = 'blue'; board[2] = 'blue'; // gap — not adjacent
    const s: GameState = { ...state, board, phase: 'mandatory' };
    const next = reducer(s, { type: 'TAKE_TOKENS', indices: [0, 2] });
    expect(next).toBe(s);
  });

  it('rejects taking a gold token', () => {
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
  it('deducts tokens, adds card to player, and awards prestige', () => {
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

  it('rejects purchase when player cannot afford the card', () => {
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

  it('Turn ability queues an extra turn on the same player', () => {
    const card = makeCard({ id: 52, ability: 'Turn', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 52, goldUsage: {} });
    expect(next.currentPlayer).toBe(0);
    expect(next.phase).toBe('optional_privilege');
    expect(next.repeatTurn).toBe(false);
    expect(next.pendingAbility).toBeNull();
    expect(next.lastPurchasedCard).toBeNull();
  });

  it('awards a royal card when purchasing a card that crosses the 3-crown milestone', () => {
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

    const afterPurchase = reducer(s, { type: 'PURCHASE_CARD', cardId: 53, goldUsage: {} });
    expect(afterPurchase.phase).toBe('choose_royal');

    const next = reducer(afterPurchase, { type: 'CHOOSE_ROYAL_CARD', cardId: 200 });
    expect(next.players[0].royalCards).toHaveLength(1);
    expect(next.players[0].royalCards[0].id).toBe(200);
    expect(next.royalDeck).toHaveLength(0);
  });
});

// ─── RESERVE_CARD ─────────────────────────────────────────────────────────────

describe('RESERVE_CARD_FROM_PYRAMID', () => {
  it('moves card to reserved, takes gold from board, and removes card from pyramid', () => {
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

  it('rejects reserving when the player already holds 3 reserved cards', () => {
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
  it('returns the privilege token to the table and takes the board token', () => {
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

// ─── DISCARD_TOKENS ───────────────────────────────────────────────────────────

describe('DISCARD_TOKENS', () => {
  it('discards tokens and advances to the next player', () => {
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

  it('rejects a discard that would leave the player still over the 10-token limit', () => {
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
  it('fills empty board cells from the bag and grants the opponent a privilege', () => {
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
    expect(next.board.filter(c => c !== null)).toHaveLength(5);
    expect(next.players[1].privileges).toBe(1);
    expect(next.phase).toBe('mandatory');
    expect(totalPrivileges(next)).toBe(3);
  });

  it('is accepted in mandatory phase when forced (no other mandatory moves), stays in mandatory', () => {
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      board: new Array(25).fill(null),
      bag: { ...emptyPool(), black: 5 },
      phase: 'mandatory',
      privileges: 3,
      players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'REPLENISH_BOARD' });
    expect(next.board.filter(c => c !== null)).toHaveLength(5);
    expect(next.players[1].privileges).toBe(1);
    expect(next.phase).toBe('mandatory');
  });

  it('is rejected in mandatory phase if bag is empty', () => {
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      board: new Array(25).fill(null),
      bag: emptyPool(),
      phase: 'mandatory',
      privileges: 3,
      players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'REPLENISH_BOARD' });
    expect(next).toBe(s);
  });
});

// ─── CARD ABILITY: Token ──────────────────────────────────────────────────────

describe('Token Ability', () => {
  it('queues resolve_ability phase then takes matching color token from board', () => {
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

    const resolved = reducer(next, { type: 'TAKE_TOKEN_FROM_BOARD', index: 5 });
    expect(resolved.board[5]).toBeNull();
    expect(resolved.players[0].tokens.red).toBe(1);
    expect(resolved.pendingAbility).toBeNull();
    expect(resolved.phase).toBe('optional_privilege');
  });

  it('skips Token ability when no matching color token is on the board', () => {
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

  it('skips Token ability on a Wild card (no color to match)', () => {
    const card = makeCard({ id: 102, ability: 'Token', color: 'wild', cost: {} });
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
  it('lets the current player steal a gem token from the opponent', () => {
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

    const resolved = reducer(next, { type: 'TAKE_TOKEN_FROM_OPPONENT', color: 'green' });
    expect(resolved.players[0].tokens.green).toBe(1);
    expect(resolved.players[1].tokens.green).toBe(1);
    expect(resolved.pendingAbility).toBeNull();
  });

  it('skips Take ability when the opponent holds no eligible (non-gold) tokens', () => {
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

  it('cannot steal gold via Take ability', () => {
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
    expect(next.pendingAbility).toBeNull();
  });
});

// ─── CARD ABILITY: Privilege ──────────────────────────────────────────────────

describe('Privilege Ability', () => {
  it('grants 1 privilege to the current player from the table', () => {
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

  it('does not grant a privilege when all 3 are already held by the player', () => {
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
    expect(next.players[0].privileges).toBe(3);
    expect(next.privileges).toBe(0);
    expect(totalPrivileges(next)).toBe(3);
  });
});

// ─── CARD ABILITY: Wild ───────────────────────────────────────────────────────

describe('Wild Ability', () => {
  it('enters assign_wild phase then assigns the chosen color permanently', () => {
    const wildCard = makeCard({ id: 110, ability: 'Wild', color: 'wild', cost: {} });
    const redCard = makeCard({ id: 111, color: 'red', bonus: 1 });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [wildCard, ...state.pyramid.level1.slice(0, 4)] },
      players: [
        makePlayer({ purchasedCards: [redCard] }),
        makePlayer(),
      ],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 110, goldUsage: {} });
    expect(next.phase).toBe('assign_wild');
    expect(next.pendingAbility).toBe('Wild');

    const resolved = reducer(next, { type: 'ASSIGN_WILD_COLOR', wildCardId: 110, color: 'red' });
    expect(resolved.players[0].purchasedCards[1].assignedColor).toBe('red');
    expect(resolved.pendingAbility).toBeNull();
  });

  it('skips Wild ability when the player has no eligible target cards', () => {
    const wildCard = makeCard({ id: 112, ability: 'Wild', color: 'wild', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [wildCard, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer({ purchasedCards: [] }), makePlayer()],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 112, goldUsage: {} });
    expect(next.players[0].purchasedCards.some(c => c.id === 112)).toBe(true);
    expect(next.phase).toBe('optional_privilege');
    expect(next.pendingAbility).toBeNull();
  });

  it('skips Wild ability when all owned cards are wild or uncolored', () => {
    const wildCard1 = makeCard({ id: 113, ability: 'Wild', color: 'wild' });
    const wildCard2 = makeCard({ id: 114, ability: 'Wild', color: 'wild' });
    const wildCard3 = makeCard({ id: 200, ability: 'Wild', color: 'wild' });
    const nullColor = makeCard({ id: 116, color: null });

    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [wildCard3, ...state.pyramid.level1.slice(0, 4)] },
      players: [
        makePlayer({
          purchasedCards: [
            nullColor,
            { ...wildCard1, assignedColor: 'red' },
            { ...wildCard2, assignedColor: 'blue' },
          ],
        }),
        makePlayer(),
      ],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 200, goldUsage: {} });
    expect(next.players[0].purchasedCards.some(c => c.id === 200)).toBe(true);
    expect(next.phase).toBe('optional_privilege');
  });

  it('ASSIGN_WILD_COLOR is rejected if the player does not own a card with that color', () => {
    const wildCard = makeCard({ id: 115, ability: 'Wild', color: 'wild', cost: {} });
    const redCard = makeCard({ id: 116, color: 'red', bonus: 1 });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'assign_wild',
      pendingAbility: 'Wild',
      lastPurchasedCard: wildCard,
      players: [
        makePlayer({ purchasedCards: [redCard, wildCard] }),
        makePlayer(),
      ],
    };

    const result = reducer(s, { type: 'ASSIGN_WILD_COLOR', wildCardId: 115, color: 'green' });
    expect(result).toBe(s); // state unchanged
  });
});

// ─── CARD ABILITY: Wild/Turn ──────────────────────────────────────────────────

describe('Wild/Turn Ability', () => {
  it('places the Wild card and keeps the turn on the same player', () => {
    const wildCard = makeCard({ id: 120, ability: 'Wild/Turn', color: 'wild', cost: {} });
    const targetCard = makeCard({ id: 121, color: 'green', bonus: 1 });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [wildCard, ...state.pyramid.level1.slice(0, 4)] },
      players: [
        makePlayer({ purchasedCards: [targetCard] }),
        makePlayer(),
      ],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 120, goldUsage: {} });
    expect(next.phase).toBe('assign_wild');

    const resolved = reducer(next, { type: 'ASSIGN_WILD_COLOR', wildCardId: 120, color: 'green' });
    expect(resolved.repeatTurn).toBe(false);
    expect(resolved.currentPlayer).toBe(0);
    expect(resolved.phase).toBe('optional_privilege');
  });
});

// ─── CARD ABILITY: Turn (chaining) ────────────────────────────────────────────

describe('Turn Ability Chaining', () => {
  it('grants an extra turn on the same player', () => {
    const turnCard = makeCard({ id: 130, ability: 'Turn', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [turnCard, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 130, goldUsage: {} });
    expect(next.repeatTurn).toBe(false);
    expect(next.currentPlayer).toBe(0);
    expect(next.phase).toBe('optional_privilege');
  });

  it('chains multiple Turn abilities by repeating the same player each time', () => {
    const turnCard1 = makeCard({ id: 131, ability: 'Turn', cost: {} });
    const turnCard2 = makeCard({ id: 132, ability: 'Turn', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [turnCard1, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };

    // Buy first Turn card — player 0 gets another turn
    const next1 = reducer(s, { type: 'PURCHASE_CARD', cardId: 131, goldUsage: {} });
    expect(next1.repeatTurn).toBe(false);
    expect(next1.currentPlayer).toBe(0);
    expect(next1.phase).toBe('optional_privilege');

    // During that extra turn, buy a second Turn card — player 0 gets yet another turn
    const next2: GameState = { ...next1, phase: 'mandatory', pyramid: { ...next1.pyramid, level1: [turnCard2, ...next1.pyramid.level1.slice(0, 4)] } };
    const next3 = reducer(next2, { type: 'PURCHASE_CARD', cardId: 132, goldUsage: {} });
    expect(next3.repeatTurn).toBe(false);
    expect(next3.currentPlayer).toBe(0);
    expect(next3.phase).toBe('optional_privilege');
  });
});

// ─── Royal Cards ──────────────────────────────────────────────────────────────

describe('Royal Card Abilities', () => {
  it('awards a royal card with Privilege ability at the 3-crown milestone', () => {
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

    const afterPurchase = reducer(s, { type: 'PURCHASE_CARD', cardId: 140, goldUsage: {} });
    expect(afterPurchase.phase).toBe('choose_royal');

    const next = reducer(afterPurchase, { type: 'CHOOSE_ROYAL_CARD', cardId: 200 });
    expect(next.players[0].royalCards).toHaveLength(1);
    expect(next.players[0].privileges).toBe(1);
    expect(next.privileges).toBe(2);
    expect(totalPrivileges(next)).toBe(3);
  });

  it('awards another royal card when crossing the 6-crown milestone', () => {
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

    const afterPurchase = reducer(s, { type: 'PURCHASE_CARD', cardId: 141, goldUsage: {} });
    expect(afterPurchase.phase).toBe('choose_royal');

    const next = reducer(afterPurchase, { type: 'CHOOSE_ROYAL_CARD', cardId: 201 });
    expect(next.players[0].royalCards).toHaveLength(1);
    expect(next.players[0].crowns).toBe(6);
  });

  it('royal card with Token ability defers to resolve_ability phase for player to choose board position', () => {
    const card = makeCard({ id: 142, crowns: 3, cost: {} });
    const royalCard = makeCard({ id: 202, level: 'royal', ability: 'Token', color: 'black', points: 3, cost: {} });
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[5] = 'black';
    board[10] = 'black';
    const s: GameState = {
      ...state,
      board,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      royalDeck: [royalCard],
      players: [makePlayer(), makePlayer()],
    };

    const afterPurchase = reducer(s, { type: 'PURCHASE_CARD', cardId: 142, goldUsage: {} });
    expect(afterPurchase.phase).toBe('choose_royal');

    const afterChoose = reducer(afterPurchase, { type: 'CHOOSE_ROYAL_CARD', cardId: 202 });
    expect(afterChoose.phase).toBe('resolve_ability');
    expect(afterChoose.pendingAbility).toBe('Token');
    // Board unchanged until player selects a position
    expect(afterChoose.board[5]).toBe('black');
    expect(afterChoose.board[10]).toBe('black');

    // Player selects position 10
    const after = reducer(afterChoose, { type: 'TAKE_TOKEN_FROM_BOARD', index: 10 });
    expect(after.board[10]).toBeNull();
    expect(after.players[0].tokens.black).toBe(1);
  });
});

// ─── Multi-ability Sequences ──────────────────────────────────────────────────

describe('Multi-ability Sequences', () => {
  it('Turn card in extra turn correctly chains with a subsequent ability card', () => {
    const turnCard = makeCard({ id: 150, ability: 'Turn', cost: {} });
    const privilegeCard = makeCard({ id: 151, ability: 'Privilege', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      privileges: 3,
      pyramid: { ...state.pyramid, level1: [turnCard, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };

    const next1 = reducer(s, { type: 'PURCHASE_CARD', cardId: 150, goldUsage: {} });
    expect(next1.repeatTurn).toBe(false);
    expect(next1.currentPlayer).toBe(0);
    expect(next1.phase).toBe('optional_privilege');

    const next2 = {
      ...next1,
      phase: 'mandatory' as const,
      pyramid: { ...next1.pyramid, level1: [privilegeCard, ...next1.pyramid.level1.slice(1)] },
    };
    const next3 = reducer(next2, { type: 'PURCHASE_CARD', cardId: 151, goldUsage: {} });
    expect(next3.players[0].privileges).toBe(1);
    expect(next3.repeatTurn).toBe(false);
    expect(next3.currentPlayer).toBe(1);
    expect(totalPrivileges(next3)).toBe(3);
  });
});

// ─── Conservation Invariants ──────────────────────────────────────────────────

describe('Conservation Invariants', () => {
  function assertConserved(before: GameState, after: GameState) {
    expect(totalTokensByColor(after)).toEqual(totalTokensByColor(before));
    expect(totalCardCount(after)).toEqual(totalCardCount(before));
  }

  it('TAKE_TOKENS conserves tokens', () => {
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[0] = 'black'; board[1] = 'red'; board[2] = 'green';
    const s: GameState = { ...state, board, phase: 'mandatory', players: [makePlayer(), makePlayer()] };
    assertConserved(s, reducer(s, { type: 'TAKE_TOKENS', indices: [0, 1, 2] }));
  });

  it('TAKE_TOKENS privilege penalty conserves tokens', () => {
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[0] = 'red'; board[1] = 'red'; board[2] = 'red';
    const s: GameState = {
      ...state, board, phase: 'mandatory',
      privileges: 3, players: [makePlayer(), makePlayer()],
    };
    assertConserved(s, reducer(s, { type: 'TAKE_TOKENS', indices: [0, 1, 2] }));
  });

  it('RESERVE_CARD_FROM_PYRAMID conserves tokens and cards', () => {
    const card = makeCard({ id: 60 });
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[12] = 'gold';
    const s: GameState = {
      ...state, board, phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };
    assertConserved(s, reducer(s, { type: 'RESERVE_CARD_FROM_PYRAMID', cardId: 60 }));
  });

  it('RESERVE_CARD from deck conserves tokens and cards', () => {
    const deckCard = makeCard({ id: 70 });
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[12] = 'gold';
    const s: GameState = {
      ...state, board, phase: 'mandatory',
      decks: { ...state.decks, level1: [deckCard, ...state.decks.level1] },
      players: [makePlayer(), makePlayer()],
    };
    assertConserved(s, reducer(s, { type: 'RESERVE_CARD', source: 'deck_1' }));
  });

  it('PURCHASE_CARD conserves tokens and cards', () => {
    const card = makeCard({ id: 80, cost: { black: 2 } });
    const state = createInitialState(false);
    const s: GameState = {
      ...state, phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer({ tokens: { ...emptyPool(), black: 2 } }), makePlayer()],
    };
    assertConserved(s, reducer(s, { type: 'PURCHASE_CARD', cardId: 80, goldUsage: {} }));
  });

  it('PURCHASE_CARD with gold usage conserves tokens and cards', () => {
    const card = makeCard({ id: 81, cost: { black: 3 } });
    const state = createInitialState(false);
    const s: GameState = {
      ...state, phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer({ tokens: { ...emptyPool(), black: 2, gold: 1 } }), makePlayer()],
    };
    assertConserved(s, reducer(s, { type: 'PURCHASE_CARD', cardId: 81, goldUsage: { black: 1 } }));
  });

  it('USE_PRIVILEGE conserves tokens', () => {
    const board = new Array(25).fill(null);
    board[5] = 'green';
    const state = createInitialState(false);
    const s: GameState = {
      ...state, board, phase: 'optional_privilege', privileges: 2,
      players: [makePlayer({ privileges: 1 }), makePlayer()],
    };
    assertConserved(s, reducer(s, { type: 'USE_PRIVILEGE', indices: [5] }));
  });

  it('REPLENISH_BOARD conserves tokens', () => {
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      board: new Array(25).fill(null),
      bag: { ...emptyPool(), black: 5 },
      phase: 'optional_replenish',
      privileges: 3,
      players: [makePlayer(), makePlayer()],
    };
    assertConserved(s, reducer(s, { type: 'REPLENISH_BOARD' }));
  });

  it('DISCARD_TOKENS conserves tokens', () => {
    const state = createInitialState(false);
    const s: GameState = {
      ...state, phase: 'discard',
      players: [makePlayer({ tokens: { ...emptyPool(), black: 11 } }), makePlayer()],
    };
    assertConserved(s, reducer(s, { type: 'DISCARD_TOKENS', tokens: { black: 1 } }));
  });

  it('TAKE_TOKEN_FROM_BOARD (Token ability) conserves tokens', () => {
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
    assertConserved(s, reducer(afterPurchase, { type: 'TAKE_TOKEN_FROM_BOARD', index: 5 }));
  });

  it('TAKE_TOKEN_FROM_OPPONENT (Take ability) conserves tokens', () => {
    const card = makeCard({ id: 103, ability: 'Take', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state, phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer({ tokens: { ...emptyPool(), green: 2 } })],
    };
    const afterPurchase = reducer(s, { type: 'PURCHASE_CARD', cardId: 103, goldUsage: {} });
    assertConserved(s, reducer(afterPurchase, { type: 'TAKE_TOKEN_FROM_OPPONENT', color: 'green' }));
  });

  it('crown milestone (royal card awarded) conserves cards', () => {
    const card = makeCard({ id: 140, crowns: 3, cost: {} });
    const royalCard = makeCard({ id: 200, level: 'royal', points: 3, cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state, phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      royalDeck: [royalCard],
      players: [makePlayer(), makePlayer()],
    };
    assertConserved(s, reducer(s, { type: 'PURCHASE_CARD', cardId: 140, goldUsage: {} }));
  });
});

// ─── Phase Transitions ────────────────────────────────────────────────────────

describe('END_OPTIONAL_PHASE', () => {
  it('transitions from optional_privilege to optional_replenish', () => {
    const state = createInitialState(false);
    const s: GameState = { ...state, phase: 'optional_privilege' };
    const next = reducer(s, { type: 'END_OPTIONAL_PHASE' });
    expect(next.phase).toBe('optional_replenish');
  });

  it('transitions from optional_replenish to mandatory', () => {
    const state = createInitialState(false);
    const s: GameState = { ...state, phase: 'optional_replenish' };
    const next = reducer(s, { type: 'END_OPTIONAL_PHASE' });
    expect(next.phase).toBe('mandatory');
  });
});

describe('SKIP_TO_MANDATORY', () => {
  it('jumps directly from optional_privilege to mandatory', () => {
    const state = createInitialState(false);
    const s: GameState = { ...state, phase: 'optional_privilege' };
    const next = reducer(s, { type: 'SKIP_TO_MANDATORY' });
    expect(next.phase).toBe('mandatory');
  });

  it('jumps directly from optional_replenish to mandatory', () => {
    const state = createInitialState(false);
    const s: GameState = { ...state, phase: 'optional_replenish' };
    const next = reducer(s, { type: 'SKIP_TO_MANDATORY' });
    expect(next.phase).toBe('mandatory');
  });
});

// ─── Invalid Phase Rejection ──────────────────────────────────────────────────

describe('Invalid phase rejection', () => {
  it('TAKE_TOKENS in optional_privilege phase returns state unchanged', () => {
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[12] = 'black';
    const s: GameState = { ...state, board, phase: 'optional_privilege' };
    const next = reducer(s, { type: 'TAKE_TOKENS', indices: [12] });
    expect(next).toBe(s);
  });

  it('PURCHASE_CARD in optional_privilege phase returns state unchanged', () => {
    const card = makeCard({ id: 50, cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'optional_privilege',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };
    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 50, goldUsage: {} });
    expect(next).toBe(s);
  });

  it('USE_PRIVILEGE in mandatory phase returns state unchanged', () => {
    const board = new Array(25).fill(null);
    board[5] = 'green';
    const state = createInitialState(false);
    const s: GameState = {
      ...state, board, phase: 'mandatory',
      players: [makePlayer({ privileges: 1 }), makePlayer()],
    };
    const next = reducer(s, { type: 'USE_PRIVILEGE', indices: [5] });
    expect(next).toBe(s);
  });
});

// ─── USE_PRIVILEGE validation ─────────────────────────────────────────────────

describe('USE_PRIVILEGE validation', () => {
  it('rejects when player has 0 privileges', () => {
    const board = new Array(25).fill(null);
    board[5] = 'green';
    const state = createInitialState(false);
    const s: GameState = {
      ...state, board, phase: 'optional_privilege', privileges: 3,
      players: [makePlayer({ privileges: 0 }), makePlayer()],
    };
    const next = reducer(s, { type: 'USE_PRIVILEGE', indices: [5] });
    expect(next).toBe(s);
  });

  it('rejects targeting a gold cell', () => {
    const board = new Array(25).fill(null);
    board[5] = 'gold';
    const state = createInitialState(false);
    const s: GameState = {
      ...state, board, phase: 'optional_privilege', privileges: 2,
      players: [makePlayer({ privileges: 1 }), makePlayer()],
    };
    const next = reducer(s, { type: 'USE_PRIVILEGE', indices: [5] });
    expect(next).toBe(s);
  });
});

// ─── RESERVE_CARD_FROM_PYRAMID validation ─────────────────────────────────────

describe('RESERVE_CARD_FROM_PYRAMID validation', () => {
  it('rejects when no gold token is on the board', () => {
    const card = makeCard({ id: 60 });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      board: new Array(25).fill(null),
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer(), makePlayer()],
    };
    const next = reducer(s, { type: 'RESERVE_CARD_FROM_PYRAMID', cardId: 60 });
    expect(next).toBe(s);
  });
});

// ─── RESERVE_CARD from deck ───────────────────────────────────────────────────

describe('RESERVE_CARD from deck', () => {
  it('takes the top deck card into reserve and grants gold', () => {
    const deckCard = makeCard({ id: 70, level: 1 });
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[12] = 'gold';
    const s: GameState = {
      ...state, board, phase: 'mandatory',
      decks: { ...state.decks, level1: [deckCard, ...state.decks.level1] },
      players: [makePlayer(), makePlayer()],
    };

    const next = reducer(s, { type: 'RESERVE_CARD', source: 'deck_1' });
    expect(next.players[0].reservedCards.some(c => c.id === 70)).toBe(true);
    expect(next.players[0].tokens.gold).toBe(1);
    expect(next.board[12]).toBeNull();
  });

  it('rejects when player already has 3 reserved cards', () => {
    const reserved = [60, 61, 62].map(id => makeCard({ id }));
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[12] = 'gold';
    const s: GameState = {
      ...state, board, phase: 'mandatory',
      players: [makePlayer({ reservedCards: reserved }), makePlayer()],
    };
    const next = reducer(s, { type: 'RESERVE_CARD', source: 'deck_1' });
    expect(next).toBe(s);
  });
});

// ─── PURCHASE_CARD from reserve ───────────────────────────────────────────────

describe('PURCHASE_CARD from reserved cards', () => {
  it('purchases a reserved card and removes it from reserve', () => {
    const card = makeCard({ id: 90, color: 'red', points: 1, cost: { red: 1 } });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      players: [
        makePlayer({ reservedCards: [card], tokens: { ...emptyPool(), red: 1 } }),
        makePlayer(),
      ],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 90, goldUsage: {} });
    expect(next.players[0].purchasedCards.some(c => c.id === 90)).toBe(true);
    expect(next.players[0].reservedCards).toHaveLength(0);
    expect(next.players[0].prestige).toBe(1);
  });
});

// ─── Victory condition in reducer ─────────────────────────────────────────────

describe('Victory detection in reducer', () => {
  it('sets game_over and winner when purchase pushes prestige to 20', () => {
    const card = makeCard({ id: 95, color: 'black', points: 5, cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [makePlayer({ prestige: 15 }), makePlayer()],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 95, goldUsage: {} });
    expect(next.phase).toBe('game_over');
    expect(next.winner).toBe(0);
    expect(next.winCondition).toBe('prestige');
  });

  it('sets game_over and winner when purchase gives 10th crown', () => {
    const card = makeCard({ id: 96, crowns: 1, cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      royalDeck: [],
      players: [makePlayer({ crowns: 9 }), makePlayer()],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 96, goldUsage: {} });
    expect(next.phase).toBe('game_over');
    expect(next.winner).toBe(0);
    expect(next.winCondition).toBe('crowns');
  });
});

// ─── Privilege Ability: takes from opponent when table is empty ───────────────

describe('Privilege Ability: fallback to opponent', () => {
  it('takes from opponent when table has 0 privileges', () => {
    const card = makeCard({ id: 108, ability: 'Privilege', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      privileges: 0,
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [
        makePlayer({ privileges: 0 }),
        makePlayer({ privileges: 3 }),
      ],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 108, goldUsage: {} });
    expect(next.players[0].privileges).toBe(1);
    expect(next.players[1].privileges).toBe(2);
    expect(totalPrivileges(next)).toBe(3);
  });

  it('grants nothing when table and opponent both have 0 privileges', () => {
    const card = makeCard({ id: 109, ability: 'Privilege', cost: {} });
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      privileges: 0,
      pyramid: { ...state.pyramid, level1: [card, ...state.pyramid.level1.slice(0, 4)] },
      players: [
        makePlayer({ privileges: 0 }),
        makePlayer({ privileges: 0 }),
      ],
    };

    const next = reducer(s, { type: 'PURCHASE_CARD', cardId: 109, goldUsage: {} });
    expect(next.players[0].privileges).toBe(0);
    expect(totalPrivileges(next)).toBe(0);
  });
});

// ─── REPLENISH_BOARD privilege cap ────────────────────────────────────────────

describe('REPLENISH_BOARD privilege cap', () => {
  it('does not give opponent a privilege beyond the cap of 3', () => {
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      board: new Array(25).fill(null),
      bag: { ...emptyPool(), black: 3 },
      phase: 'optional_replenish',
      privileges: 0,
      players: [makePlayer(), makePlayer({ privileges: 3 })],
    };

    const next = reducer(s, { type: 'REPLENISH_BOARD' });
    expect(next.players[1].privileges).toBe(3);
    expect(totalPrivileges(next)).toBe(3);
  });
});

// ─── TAKE_TOKENS privilege cap ────────────────────────────────────────────────

describe('TAKE_TOKENS privilege penalty cap', () => {
  it('does not give opponent more than 3 privileges when already at cap', () => {
    const state = createInitialState(false);
    const board = new Array(25).fill(null);
    board[0] = 'red'; board[1] = 'red'; board[2] = 'red';
    const s: GameState = {
      ...state, board, phase: 'mandatory',
      privileges: 0,
      players: [makePlayer(), makePlayer({ privileges: 3 })],
    };

    const next = reducer(s, { type: 'TAKE_TOKENS', indices: [0, 1, 2] });
    expect(next.players[1].privileges).toBe(3);
    expect(totalPrivileges(next)).toBe(3);
  });
});

// ─── legalMoves ───────────────────────────────────────────────────────────────

describe('legalMoves', () => {
  it('returns empty array during game_over phase', () => {
    const { legalMoves } = require('../legalMoves');
    const state = createInitialState(false);
    const s: GameState = { ...state, phase: 'game_over', winner: 0, winCondition: 'prestige' };
    expect(legalMoves(s)).toHaveLength(0);
  });

  it('always includes END_OPTIONAL_PHASE and SKIP_TO_MANDATORY in optional_privilege phase', () => {
    const { legalMoves } = require('../legalMoves');
    const state = createInitialState(false);
    const s: GameState = { ...state, phase: 'optional_privilege' };
    const moves = legalMoves(s);
    expect(moves.some((m: { type: string }) => m.type === 'END_OPTIONAL_PHASE')).toBe(true);
    expect(moves.some((m: { type: string }) => m.type === 'SKIP_TO_MANDATORY')).toBe(true);
  });

  it('includes REPLENISH_BOARD in optional_replenish phase only when bag is non-empty', () => {
    const { legalMoves } = require('../legalMoves');
    const state = createInitialState(false);

    const withTokens: GameState = { ...state, phase: 'optional_replenish', bag: { ...emptyPool(), black: 1 } };
    expect(legalMoves(withTokens).some((m: { type: string }) => m.type === 'REPLENISH_BOARD')).toBe(true);

    const withoutTokens: GameState = { ...state, phase: 'optional_replenish', bag: emptyPool() };
    expect(legalMoves(withoutTokens).some((m: { type: string }) => m.type === 'REPLENISH_BOARD')).toBe(false);
  });

  it('forces REPLENISH_BOARD in mandatory phase when no other mandatory moves exist and bag is non-empty', () => {
    const { legalMoves } = require('../legalMoves');
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      board: new Array(25).fill(null),
      bag: { ...emptyPool(), black: 5 },
      phase: 'mandatory',
      pyramid: { level1: [], level2: [], level3: [] },
      decks: { level1: [], level2: [], level3: [] },
      players: [makePlayer(), makePlayer()],
    };
    const moves = legalMoves(s);
    expect(moves).toHaveLength(1);
    expect(moves[0].type).toBe('REPLENISH_BOARD');
  });

  it('returns only PASS_MANDATORY when bag is also empty and no mandatory moves exist', () => {
    const { legalMoves } = require('../legalMoves');
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      board: new Array(25).fill(null),
      bag: emptyPool(),
      phase: 'mandatory',
      pyramid: { level1: [], level2: [], level3: [] },
      decks: { level1: [], level2: [], level3: [] },
      players: [makePlayer(), makePlayer()],
    };
    const moves = legalMoves(s);
    expect(moves).toHaveLength(1);
    expect(moves[0].type).toBe('PASS_MANDATORY');
  });
});

// ─── PASS_MANDATORY ───────────────────────────────────────────────────────────

describe('PASS_MANDATORY', () => {
  it('advances the turn when the player is within the token limit', () => {
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      players: [makePlayer({ tokens: { ...emptyPool(), black: 5 } }), makePlayer()],
    };

    const next = reducer(s, { type: 'PASS_MANDATORY' });
    expect(next.phase).toBe('optional_privilege');
    expect(next.currentPlayer).toBe(1);
  });

  it('triggers discard phase when the player holds more than 10 tokens', () => {
    const state = createInitialState(false);
    const s: GameState = {
      ...state,
      phase: 'mandatory',
      players: [
        makePlayer({ tokens: { ...emptyPool(), white: 2, blue: 2, green: 4, red: 4 } }),
        makePlayer(),
      ],
    };

    const next = reducer(s, { type: 'PASS_MANDATORY' });
    expect(next.phase).toBe('discard');
    expect(next.currentPlayer).toBe(0);
  });

  it('is rejected outside mandatory phase', () => {
    const state = createInitialState(false);
    const s: GameState = { ...state, phase: 'optional_privilege' };
    const next = reducer(s, { type: 'PASS_MANDATORY' });
    expect(next).toBe(s);
  });
});
