import { legalMoves } from '../legalMoves';
import { reducer } from '../reducer';
import { createInitialState } from '../initialState';
import { emptyPool, BOARD_SIZE } from '../helpers';
import type { Action, GameState } from '../types';
import { makeCard, makePlayer, deadlockedMandatoryState } from './fixtures';

/**
 * legalMoves is what every consumer actually depends on: the CLI renders it, the
 * React client indexes it, and the RL action mask is built from it. It had no
 * dedicated coverage — it was only exercised incidentally through reducer tests.
 */

function emptyBoard(): GameState['board'] {
  return new Array(BOARD_SIZE).fill(null);
}

function boardWith(cells: Record<number, GameState['board'][number]>): GameState['board'] {
  const board = emptyBoard();
  for (const [index, value] of Object.entries(cells)) board[Number(index)] = value;
  return board;
}

function typesIn(moves: Action[]): Set<Action['type']> {
  return new Set(moves.map(move => move.type));
}

describe('phase routing', () => {
  it('returns no moves once the game is over', () => {
    // Arrange
    const state: GameState = { ...createInitialState(false, 1), phase: 'game_over' };

    // Act / Assert
    expect(legalMoves(state)).toEqual([]);
  });

  it('offers only royal choices in choose_royal', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const state: GameState = { ...base, phase: 'choose_royal' };

    // Act
    const moves = legalMoves(state);

    // Assert
    expect(typesIn(moves)).toEqual(new Set(['CHOOSE_ROYAL_CARD']));
    expect(moves).toHaveLength(base.royalDeck.length);
  });
});

describe('optional_privilege', () => {
  it('always allows ending the phase, even with no privileges', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const state: GameState = {
      ...base, phase: 'optional_privilege', players: [makePlayer(), makePlayer()],
    };

    // Act
    const moves = legalMoves(state);

    // Assert
    expect(typesIn(moves)).toEqual(new Set(['END_OPTIONAL_PHASE', 'SKIP_TO_MANDATORY']));
  });

  it('offers one USE_PRIVILEGE per non-gold token on the board', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const state: GameState = {
      ...base,
      phase: 'optional_privilege',
      board: boardWith({ 0: 'red', 1: 'gold', 2: 'pearl' }),
      players: [makePlayer({ privileges: 1 }), makePlayer()],
    };

    // Act
    const privilegeMoves = legalMoves(state).filter(move => move.type === 'USE_PRIVILEGE');

    // Assert — gold is never takeable with a privilege.
    expect(privilegeMoves).toEqual([
      { type: 'USE_PRIVILEGE', index: 0 },
      { type: 'USE_PRIVILEGE', index: 2 },
    ]);
  });
});

describe('optional_replenish', () => {
  it('offers REPLENISH_BOARD only when the bag has tokens', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const withTokens: GameState = {
      ...base, phase: 'optional_replenish', bag: { ...emptyPool(), red: 2 },
    };
    const withEmptyBag: GameState = { ...base, phase: 'optional_replenish', bag: emptyPool() };

    // Act / Assert
    expect(typesIn(legalMoves(withTokens))).toContain('REPLENISH_BOARD');
    expect(typesIn(legalMoves(withEmptyBag))).not.toContain('REPLENISH_BOARD');
  });
});

describe('mandatory: taking tokens', () => {
  it('enumerates only straight unbroken lines of 1 to 3 cells', () => {
    // Arrange — a horizontal run of three at indices 0,1,2.
    const base = createInitialState(false, 1);
    const state: GameState = {
      ...base,
      phase: 'mandatory',
      board: boardWith({ 0: 'red', 1: 'blue', 2: 'green' }),
      players: [makePlayer(), makePlayer()],
    };

    // Act
    const lines = legalMoves(state)
      .filter((move): move is Extract<Action, { type: 'TAKE_TOKENS' }> => move.type === 'TAKE_TOKENS')
      .map(move => move.indices.join(','));

    // Assert — three singles, two pairs, one triple.
    expect(new Set(lines)).toEqual(new Set(['0', '1', '2', '0,1', '1,2', '0,1,2']));
  });

  it('never offers a line that spans a gap', () => {
    // Arrange — tokens at 0 and 2, nothing at 1.
    const base = createInitialState(false, 1);
    const state: GameState = {
      ...base,
      phase: 'mandatory',
      board: boardWith({ 0: 'red', 2: 'green' }),
      players: [makePlayer(), makePlayer()],
    };

    // Act
    const lines = legalMoves(state)
      .filter((move): move is Extract<Action, { type: 'TAKE_TOKENS' }> => move.type === 'TAKE_TOKENS')
      .map(move => move.indices.join(','));

    // Assert
    expect(new Set(lines)).toEqual(new Set(['0', '2']));
  });

  it('never offers gold', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const state: GameState = {
      ...base,
      phase: 'mandatory',
      board: boardWith({ 0: 'gold', 1: 'gold' }),
      players: [makePlayer(), makePlayer()],
    };

    // Act / Assert
    expect(typesIn(legalMoves(state))).not.toContain('TAKE_TOKENS');
  });

  it('offers diagonal lines', () => {
    // Arrange — 0, 6, 12 is a diagonal on a 5-wide board.
    const base = createInitialState(false, 1);
    const state: GameState = {
      ...base,
      phase: 'mandatory',
      board: boardWith({ 0: 'red', 6: 'blue', 12: 'green' }),
      players: [makePlayer(), makePlayer()],
    };

    // Act
    const lines = legalMoves(state)
      .filter((move): move is Extract<Action, { type: 'TAKE_TOKENS' }> => move.type === 'TAKE_TOKENS')
      .map(move => move.indices.join(','));

    // Assert
    expect(lines).toContain('0,6,12');
  });
});

describe('mandatory: reserving', () => {
  it('offers no reserve moves when no gold is on the board', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const state: GameState = {
      ...base, phase: 'mandatory', board: boardWith({ 0: 'red' }),
      players: [makePlayer(), makePlayer()],
    };

    // Act
    const types = typesIn(legalMoves(state));

    // Assert
    expect(types).not.toContain('RESERVE_CARD_FROM_PYRAMID');
    expect(types).not.toContain('RESERVE_CARD_FROM_DECK');
  });

  it('offers no reserve moves when the reserve is already full', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const reserved = [makeCard({ id: 901 }), makeCard({ id: 902 }), makeCard({ id: 903 })];
    const state: GameState = {
      ...base,
      phase: 'mandatory',
      board: boardWith({ 0: 'gold' }),
      players: [makePlayer({ reservedCards: reserved }), makePlayer()],
    };

    // Act
    const types = typesIn(legalMoves(state));

    // Assert
    expect(types).not.toContain('RESERVE_CARD_FROM_PYRAMID');
    expect(types).not.toContain('RESERVE_CARD_FROM_DECK');
  });

  it('offers a deck reserve per non-empty deck only', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const state: GameState = {
      ...base,
      phase: 'mandatory',
      board: boardWith({ 0: 'gold' }),
      decks: { level1: base.decks.level1, level2: [], level3: [] },
      players: [makePlayer(), makePlayer()],
    };

    // Act
    const sources = legalMoves(state)
      .filter((m): m is Extract<Action, { type: 'RESERVE_CARD_FROM_DECK' }> =>
        m.type === 'RESERVE_CARD_FROM_DECK')
      .map(m => m.source);

    // Assert
    expect(sources).toEqual(['deck_1']);
  });
});

describe('mandatory: purchasing', () => {
  it('offers a free card and spends no gold on it', () => {
    // Arrange — a zero-cost card is affordable with nothing.
    const base = createInitialState(false, 1);
    const free = makeCard({ id: 910, cost: {} });
    const state: GameState = {
      ...base,
      phase: 'mandatory',
      pyramid: { ...base.pyramid, level1: [free] },
      players: [makePlayer(), makePlayer()],
    };

    // Act
    const purchases = legalMoves(state)
      .filter((m): m is Extract<Action, { type: 'PURCHASE_CARD' }> => m.type === 'PURCHASE_CARD');

    // Assert
    expect(purchases).toEqual([{ type: 'PURCHASE_CARD', cardId: 910, goldUsage: {} }]);
  });

  it('covers a shortfall with the minimal gold allocation', () => {
    // Arrange — needs 2 red, player holds 1 red and 1 gold.
    const base = createInitialState(false, 1);
    const card = makeCard({ id: 911, cost: { red: 2 } });
    const state: GameState = {
      ...base,
      phase: 'mandatory',
      pyramid: { ...base.pyramid, level1: [card] },
      players: [
        makePlayer({ tokens: { ...emptyPool(), red: 1, gold: 1 } }),
        makePlayer(),
      ],
    };

    // Act
    const purchases = legalMoves(state)
      .filter((m): m is Extract<Action, { type: 'PURCHASE_CARD' }> => m.type === 'PURCHASE_CARD');

    // Assert — exactly one option, covering only the 1-token shortfall.
    expect(purchases).toEqual([{ type: 'PURCHASE_CARD', cardId: 911, goldUsage: { red: 1 } }]);
  });

  it('does not offer a card the player cannot afford even with gold', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const card = makeCard({ id: 912, cost: { red: 3 } });
    const state: GameState = {
      ...base,
      phase: 'mandatory',
      pyramid: { ...base.pyramid, level1: [card] },
      players: [makePlayer({ tokens: { ...emptyPool(), red: 1 } }), makePlayer()],
    };

    // Act / Assert
    expect(typesIn(legalMoves(state))).not.toContain('PURCHASE_CARD');
  });

  it('applies bonuses before deciding affordability', () => {
    // Arrange — a red bonus card reduces a 1-red cost to nothing.
    const base = createInitialState(false, 1);
    const target = makeCard({ id: 913, cost: { red: 1 } });
    const redBonus = makeCard({ id: 914, color: 'red', bonus: 1 });
    const state: GameState = {
      ...base,
      phase: 'mandatory',
      pyramid: { ...base.pyramid, level1: [target] },
      players: [makePlayer({ purchasedCards: [redBonus] }), makePlayer()],
    };

    // Act
    const purchases = legalMoves(state)
      .filter((m): m is Extract<Action, { type: 'PURCHASE_CARD' }> => m.type === 'PURCHASE_CARD');

    // Assert
    expect(purchases).toEqual([{ type: 'PURCHASE_CARD', cardId: 913, goldUsage: {} }]);
  });

  it('withholds a wild card until the player owns a colored card', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const wild = makeCard({ id: 915, ability: 'wild', color: null, cost: {} });
    const withoutColor: GameState = {
      ...base,
      phase: 'mandatory',
      pyramid: { ...base.pyramid, level1: [wild] },
      players: [makePlayer(), makePlayer()],
    };
    const withColor: GameState = {
      ...withoutColor,
      players: [makePlayer({ purchasedCards: [makeCard({ id: 916, color: 'blue' })] }), makePlayer()],
    };

    // Act / Assert
    expect(typesIn(legalMoves(withoutColor))).not.toContain('PURCHASE_CARD');
    expect(typesIn(legalMoves(withColor))).toContain('PURCHASE_CARD');
  });

  it('offers reserved cards alongside pyramid cards', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const reserved = makeCard({ id: 917, cost: {} });
    const state: GameState = {
      ...base,
      phase: 'mandatory',
      pyramid: { level1: [], level2: [], level3: [] },
      players: [makePlayer({ reservedCards: [reserved] }), makePlayer()],
    };

    // Act
    const purchases = legalMoves(state)
      .filter((m): m is Extract<Action, { type: 'PURCHASE_CARD' }> => m.type === 'PURCHASE_CARD')
      .map(m => m.cardId);

    // Assert
    expect(purchases).toEqual([917]);
  });
});

describe('mandatory: forced fallbacks', () => {
  it('forces a replenish when nothing else is playable and the bag has tokens', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const state = deadlockedMandatoryState(base, {
      bag: { ...emptyPool(), red: 2 },
      players: [makePlayer(), makePlayer()],
    });

    // Act / Assert — the rulebook requires the replenish before a mandatory action.
    expect(legalMoves(state)).toEqual([{ type: 'REPLENISH_BOARD' }]);
  });

  it('falls back to PASS_MANDATORY only in a true deadlock', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const state = deadlockedMandatoryState(base, {
      players: [makePlayer(), makePlayer()],
    });

    // Act / Assert
    expect(legalMoves(state)).toEqual([{ type: 'PASS_MANDATORY' }]);
  });
});

describe('resolve_ability', () => {
  it('offers only matching-color board cells for a Token ability', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const card = makeCard({ id: 920, color: 'red', ability: 'Token' });
    const state: GameState = {
      ...base,
      phase: 'resolve_ability',
      pendingAbility: 'Token',
      lastPurchasedCard: card,
      board: boardWith({ 0: 'red', 1: 'blue', 2: 'red' }),
      players: [makePlayer(), makePlayer()],
    };

    // Act
    const moves = legalMoves(state);

    // Assert
    expect(moves).toEqual([
      { type: 'TAKE_TOKEN_FROM_BOARD', index: 0 },
      { type: 'TAKE_TOKEN_FROM_BOARD', index: 2 },
    ]);
  });

  it('offers only colors the opponent actually holds for a Take ability, never gold', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const card = makeCard({ id: 921, color: 'red', ability: 'Take' });
    const state: GameState = {
      ...base,
      phase: 'resolve_ability',
      pendingAbility: 'Take',
      lastPurchasedCard: card,
      players: [
        makePlayer(),
        makePlayer({ tokens: { ...emptyPool(), blue: 1, pearl: 2, gold: 3 } }),
      ],
    };

    // Act
    const colors = legalMoves(state)
      .filter((m): m is Extract<Action, { type: 'TAKE_TOKEN_FROM_OPPONENT' }> =>
        m.type === 'TAKE_TOKEN_FROM_OPPONENT')
      .map(m => m.color);

    // Assert
    expect(new Set(colors)).toEqual(new Set(['blue', 'pearl']));
  });
});

describe('assign_wild', () => {
  it('offers each distinct intrinsic color the player owns, excluding the wild itself', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const wild = makeCard({ id: 930, ability: 'wild', color: null });
    const state: GameState = {
      ...base,
      phase: 'assign_wild',
      pendingAbility: 'wild',
      lastPurchasedCard: wild,
      players: [
        makePlayer({
          purchasedCards: [
            makeCard({ id: 931, color: 'red' }),
            makeCard({ id: 932, color: 'red' }),
            makeCard({ id: 933, color: 'blue' }),
            wild,
          ],
        }),
        makePlayer(),
      ],
    };

    // Act
    const colors = legalMoves(state)
      .filter((m): m is Extract<Action, { type: 'ASSIGN_WILD_COLOR' }> =>
        m.type === 'ASSIGN_WILD_COLOR')
      .map(m => m.color);

    // Assert — deduplicated, and the wild contributes nothing itself.
    expect(new Set(colors)).toEqual(new Set(['red', 'blue']));
    expect(colors).toHaveLength(2);
  });
});

describe('discard', () => {
  it('offers one discard per color the player holds', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const state: GameState = {
      ...base,
      phase: 'discard',
      players: [
        makePlayer({ tokens: { ...emptyPool(), red: 6, blue: 4, gold: 1 } }),
        makePlayer(),
      ],
    };

    // Act
    const colors = legalMoves(state)
      .filter((m): m is Extract<Action, { type: 'DISCARD_TOKENS' }> => m.type === 'DISCARD_TOKENS')
      .map(m => m.color);

    // Assert — gold is discardable; it counts toward the 10-token limit.
    expect(new Set(colors)).toEqual(new Set(['red', 'blue', 'gold']));
  });

  it('offers nothing once the player is at or under the limit', () => {
    // Arrange
    const base = createInitialState(false, 1);
    const state: GameState = {
      ...base,
      phase: 'discard',
      players: [makePlayer({ tokens: { ...emptyPool(), red: 5 } }), makePlayer()],
    };

    // Act / Assert
    expect(legalMoves(state)).toEqual([]);
  });
});

// Every move legalMoves emits must be one the reducer actually applies. The fuzz
// suite checks this along random trajectories; this pins it at the opening state,
// where the move list is at its widest.
describe('every offered move is accepted by the reducer', () => {
  it('holds for the full opening move list', () => {
    // Arrange
    const state = createInitialState(true, 5150);
    const moves = legalMoves(state);
    expect(moves.length).toBeGreaterThan(20);

    // Act / Assert
    for (const move of moves) {
      expect(reducer(state, move)).not.toBe(state);
    }
  });
});
