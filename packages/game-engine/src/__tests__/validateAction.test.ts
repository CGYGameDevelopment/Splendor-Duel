import { validateAction } from '../validateAction';
import { reducer } from '../reducer';
import { createInitialState } from '../initialState';
import { emptyPool, totalTokens, TOKEN_COLORS } from '../helpers';
import type { GameState } from '../types';
import { makeCard, makePlayer } from './fixtures';

function reason(action: unknown): string {
  const result = validateAction(action);
  if (result.valid) throw new Error('expected the action to be rejected');
  return result.error.reason;
}

describe('validateAction', () => {
  describe('non-actions', () => {
    it.each([null, undefined, 42, 'TAKE_TOKENS', [], [{ type: 'PASS_MANDATORY' }]])(
      'rejects %p',
      value => {
        expect(validateAction(value).valid).toBe(false);
      },
    );

    it('rejects an object with no type', () => {
      expect(reason({ index: 3 })).toMatch(/type must be a string/);
    });

    it('rejects an unknown action type', () => {
      expect(reason({ type: 'DELETE_OPPONENT' })).toMatch(/Unknown action type/);
    });
  });

  describe('nullary actions', () => {
    it.each(['END_OPTIONAL_PHASE', 'SKIP_TO_MANDATORY', 'REPLENISH_BOARD', 'PASS_MANDATORY'])(
      'accepts %s',
      type => {
        expect(validateAction({ type })).toEqual({ valid: true, action: { type } });
      },
    );

    it('drops extra fields rather than passing them through', () => {
      const result = validateAction({ type: 'PASS_MANDATORY', sneaky: 'payload' });

      expect(result).toEqual({ valid: true, action: { type: 'PASS_MANDATORY' } });
    });
  });

  describe('USE_PRIVILEGE', () => {
    it('accepts an in-range board index', () => {
      expect(validateAction({ type: 'USE_PRIVILEGE', index: 12 }))
        .toEqual({ valid: true, action: { type: 'USE_PRIVILEGE', index: 12 } });
    });

    it.each([-1, 25, 1.5, NaN, Infinity, '3', null, undefined])('rejects index %p', index => {
      expect(validateAction({ type: 'USE_PRIVILEGE', index }).valid).toBe(false);
    });
  });

  describe('TAKE_TOKENS', () => {
    it('accepts 1 to 3 distinct in-range indices', () => {
      expect(validateAction({ type: 'TAKE_TOKENS', indices: [0] }).valid).toBe(true);
      expect(validateAction({ type: 'TAKE_TOKENS', indices: [0, 1, 2] }).valid).toBe(true);
    });

    it('rejects an empty selection', () => {
      expect(reason({ type: 'TAKE_TOKENS', indices: [] })).toMatch(/1\.\.3 indices/);
    });

    it('rejects more than three indices', () => {
      expect(reason({ type: 'TAKE_TOKENS', indices: [0, 1, 2, 3] })).toMatch(/1\.\.3 indices/);
    });

    it('rejects repeated indices, which would take the same token twice', () => {
      expect(reason({ type: 'TAKE_TOKENS', indices: [5, 5] })).toMatch(/distinct/);
    });

    it('rejects out-of-range and non-integer indices', () => {
      expect(validateAction({ type: 'TAKE_TOKENS', indices: [0, 99] }).valid).toBe(false);
      expect(validateAction({ type: 'TAKE_TOKENS', indices: [0, 1.5] }).valid).toBe(false);
    });

    it('rejects a non-array indices field', () => {
      expect(reason({ type: 'TAKE_TOKENS', indices: 5 })).toMatch(/indices array/);
    });

    it('copies the indices array so the caller cannot mutate it afterwards', () => {
      const indices = [1, 2];
      const result = validateAction({ type: 'TAKE_TOKENS', indices });
      indices.push(3);

      expect(result.valid && result.action).toEqual({ type: 'TAKE_TOKENS', indices: [1, 2] });
    });
  });

  describe('DISCARD_TOKENS', () => {
    it('accepts every known token color', () => {
      for (const color of TOKEN_COLORS) {
        expect(validateAction({ type: 'DISCARD_TOKENS', color }).valid).toBe(true);
      }
    });

    it('rejects an unknown color', () => {
      expect(reason({ type: 'DISCARD_TOKENS', color: 'notacolor' })).toMatch(/known token color/);
    });

    it('rejects the old multi-token payload shape', () => {
      expect(validateAction({ type: 'DISCARD_TOKENS', tokens: { black: 1 } }).valid).toBe(false);
    });
  });

  describe('TAKE_TOKEN_FROM_OPPONENT', () => {
    it('accepts a known token color', () => {
      expect(validateAction({ type: 'TAKE_TOKEN_FROM_OPPONENT', color: 'pearl' }).valid).toBe(true);
    });

    it('rejects an unknown color', () => {
      expect(reason({ type: 'TAKE_TOKEN_FROM_OPPONENT', color: 'notacolor' }))
        .toMatch(/known token color/);
    });
  });

  describe('PURCHASE_CARD', () => {
    it('accepts a card id with no gold usage', () => {
      expect(validateAction({ type: 'PURCHASE_CARD', cardId: 7 }))
        .toEqual({ valid: true, action: { type: 'PURCHASE_CARD', cardId: 7, goldUsage: {} } });
    });

    it('accepts a well-formed gold allocation', () => {
      const result = validateAction({
        type: 'PURCHASE_CARD', cardId: 7, goldUsage: { red: 1, pearl: 2 },
      });

      expect(result.valid && result.action).toEqual({
        type: 'PURCHASE_CARD', cardId: 7, goldUsage: { red: 1, pearl: 2 },
      });
    });

    it('rejects an unknown color in the gold allocation', () => {
      expect(reason({ type: 'PURCHASE_CARD', cardId: 7, goldUsage: { notacolor: 1 } }))
        .toMatch(/unknown color/);
    });

    it('rejects gold as a gold-allocation target, since gold cannot pay for itself', () => {
      expect(validateAction({ type: 'PURCHASE_CARD', cardId: 7, goldUsage: { gold: 1 } }).valid)
        .toBe(false);
    });

    it.each([-1, 1.5, NaN, Infinity, '1'])('rejects gold amount %p', amount => {
      expect(validateAction({ type: 'PURCHASE_CARD', cardId: 7, goldUsage: { red: amount } }).valid)
        .toBe(false);
    });

    it.each([0, -3, 1.5, 'x', null])('rejects cardId %p', cardId => {
      expect(validateAction({ type: 'PURCHASE_CARD', cardId }).valid).toBe(false);
    });
  });

  describe('ASSIGN_WILD_COLOR', () => {
    it('accepts a gem color', () => {
      expect(validateAction({ type: 'ASSIGN_WILD_COLOR', wildCardId: 3, color: 'green' }).valid)
        .toBe(true);
    });

    it('rejects pearl and gold, which are not gem colors', () => {
      expect(validateAction({ type: 'ASSIGN_WILD_COLOR', wildCardId: 3, color: 'pearl' }).valid)
        .toBe(false);
      expect(validateAction({ type: 'ASSIGN_WILD_COLOR', wildCardId: 3, color: 'gold' }).valid)
        .toBe(false);
    });
  });

  describe('RESERVE_CARD_FROM_DECK', () => {
    it.each(['deck_1', 'deck_2', 'deck_3'])('accepts source %s', source => {
      expect(validateAction({ type: 'RESERVE_CARD_FROM_DECK', source }).valid).toBe(true);
    });

    it('rejects an unknown source', () => {
      expect(reason({ type: 'RESERVE_CARD_FROM_DECK', source: 'deck_4' })).toMatch(/deck_1/);
    });
  });
});

// ─── Regression: malformed payloads must not corrupt token pools ──────────────
//
// Both cases below used to be *accepted* by the reducer. An unknown color key
// slipped past guards of the form `tokens[color] < 1` (undefined < 1 is false),
// and the reducer then wrote `undefined - 1` — NaN — into a token pool and the
// bag. The conservation helpers only sum known colors, so nothing noticed.

describe('malformed-payload regressions', () => {
  function assertPoolsAreClean(state: GameState): void {
    const pools = [state.bag, state.players[0].tokens, state.players[1].tokens];
    for (const pool of pools) {
      expect(Object.keys(pool).sort()).toEqual([...TOKEN_COLORS].sort());
      for (const color of TOKEN_COLORS) {
        expect(Number.isInteger(pool[color])).toBe(true);
        expect(pool[color]).toBeGreaterThanOrEqual(0);
      }
    }
    expect(Number.isInteger(totalTokens(state.bag))).toBe(true);
  }

  it('rejects TAKE_TOKEN_FROM_OPPONENT with an unknown color', () => {
    // Arrange — a state parked in resolve_ability with a pending Take
    const base = createInitialState(true, 1);
    const state: GameState = {
      ...base,
      phase: 'resolve_ability',
      pendingAbility: 'Take',
      lastPurchasedCard: makeCard({ id: 999, color: 'red', ability: 'Take' }),
      players: [
        makePlayer({ tokens: { ...emptyPool(), red: 2 } }),
        makePlayer({ tokens: { ...emptyPool(), red: 2 } }),
      ],
    };

    // Act
    const next = reducer(state, { type: 'TAKE_TOKEN_FROM_OPPONENT', color: 'notacolor' } as never);

    // Assert
    expect(next).toBe(state);
    assertPoolsAreClean(next);
  });

  it('rejects DISCARD_TOKENS with an unknown color', () => {
    // Arrange
    const base = createInitialState(true, 2);
    const state: GameState = {
      ...base,
      phase: 'discard',
      players: [makePlayer({ tokens: { ...emptyPool(), black: 11 } }), makePlayer()],
    };

    // Act
    const next = reducer(state, { type: 'DISCARD_TOKENS', color: 'notacolor' } as never);

    // Assert
    expect(next).toBe(state);
    assertPoolsAreClean(next);
  });

  it('rejects an entirely unknown action type', () => {
    // Arrange
    const state = createInitialState(true, 3);

    // Act
    const next = reducer(state, { type: 'GIVE_ME_TOKENS', color: 'red' } as never);

    // Assert
    expect(next).toBe(state);
  });
});
