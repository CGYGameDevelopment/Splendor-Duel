import { applyAction } from '../applyAction';
import { createInitialState } from '../initialState';
import { legalMoves } from '../legalMoves';
import { reducer } from '../reducer';
import { emptyPool } from '../helpers';
import type { GameState } from '../types';
import { makeCard, makePlayer, deadlockedMandatoryState } from './fixtures';

describe('applyAction', () => {
  describe('successful application', () => {
    it('returns the new state for a legal move', () => {
      // Arrange
      const state = createInitialState(true, 101);
      const move = legalMoves(state)[0];

      // Act
      const result = applyAction(state, move);

      // Assert
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected success');
      expect(result.state).not.toBe(state);
      expect(result.state).toEqual(reducer(state, move));
    });

    it('accepts every move legalMoves offers from the opening position', () => {
      // Arrange
      const state = createInitialState(true, 202);

      // Act / Assert
      for (const move of legalMoves(state)) {
        expect(applyAction(state, move).ok).toBe(true);
      }
    });
  });

  describe('malformed payloads', () => {
    it.each([
      [null],
      [{}],
      [{ type: 'NOT_A_MOVE' }],
      [{ type: 'DISCARD_TOKENS', color: 'notacolor' }],
      [{ type: 'USE_PRIVILEGE', index: 99 }],
    ])('rejects %p as malformed', payload => {
      // Arrange
      const state = createInitialState(true, 303);

      // Act
      const result = applyAction(state, payload);

      // Assert
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected rejection');
      expect(result.error.kind).toBe('malformed');
      expect(result.error.reason.length).toBeGreaterThan(0);
    });
  });

  describe('illegal moves carry an explanation', () => {
    it('names the phase when the action belongs to another one', () => {
      // Arrange — a discard dispatched during the main action step.
      const state: GameState = { ...createInitialState(true, 404), phase: 'mandatory' };

      // Act
      const result = applyAction(state, { type: 'DISCARD_TOKENS', color: 'red' });

      // Assert
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected rejection');
      expect(result.error.kind).toBe('illegal');
      expect(result.error.reason).toMatch(/main action step/);
    });

    it('explains an unaffordable purchase', () => {
      // Arrange
      const base = createInitialState(false, 505);
      const card = makeCard({ id: 800, cost: { red: 3 } });
      const state: GameState = {
        ...base,
        phase: 'mandatory',
        pyramid: { ...base.pyramid, level1: [card] },
        players: [makePlayer(), makePlayer()],
      };

      // Act
      const result = applyAction(state, { type: 'PURCHASE_CARD', cardId: 800, goldUsage: {} });

      // Assert
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected rejection');
      expect(result.error.reason).toMatch(/cannot afford/i);
    });

    it('explains a wild purchase with no coloured card', () => {
      // Arrange
      const base = createInitialState(false, 606);
      const wild = makeCard({ id: 801, ability: 'wild', color: null, cost: {} });
      const state: GameState = {
        ...base,
        phase: 'mandatory',
        pyramid: { ...base.pyramid, level1: [wild] },
        players: [makePlayer(), makePlayer()],
      };

      // Act
      const result = applyAction(state, { type: 'PURCHASE_CARD', cardId: 801, goldUsage: {} });

      // Assert
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected rejection');
      expect(result.error.reason).toMatch(/card with a colour/i);
    });

    it('explains a reserve with no gold on the board', () => {
      // Arrange
      const base = createInitialState(false, 707);
      const state = deadlockedMandatoryState(base, {
        pyramid: { ...base.pyramid, level1: [makeCard({ id: 802, cost: { red: 9 } })] },
        players: [makePlayer(), makePlayer()],
      });

      // Act
      const result = applyAction(state, { type: 'RESERVE_CARD_FROM_PYRAMID', cardId: 802 });

      // Assert
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected rejection');
      expect(result.error.reason).toMatch(/gold token/i);
    });

    it('explains a privilege use with no scrolls', () => {
      // Arrange
      const base = createInitialState(false, 808);
      const board = new Array(25).fill(null);
      board[0] = 'red';
      const state: GameState = {
        ...base,
        phase: 'optional_privilege',
        board,
        players: [makePlayer(), makePlayer()],
      };

      // Act
      const result = applyAction(state, { type: 'USE_PRIVILEGE', index: 0 });

      // Assert
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected rejection');
      expect(result.error.reason).toMatch(/no privilege/i);
    });

    it('explains that passing is only for a deadlock', () => {
      // Arrange — the opening board has plenty of legal actions.
      const state: GameState = { ...createInitialState(false, 909), phase: 'mandatory' };

      // Act
      const result = applyAction(state, { type: 'PASS_MANDATORY' });

      // Assert
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected rejection');
      expect(result.error.reason).toMatch(/deadlock/i);
    });

    it('explains that gold cannot be taken as tokens', () => {
      // Arrange
      const base = createInitialState(false, 1010);
      const board = new Array(25).fill(null);
      board[0] = 'gold';
      const state: GameState = {
        ...base, phase: 'mandatory', board, players: [makePlayer(), makePlayer()],
      };

      // Act
      const result = applyAction(state, { type: 'TAKE_TOKENS', indices: [0] });

      // Assert
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected rejection');
      expect(result.error.reason).toMatch(/gold/i);
    });

    it('reports a finished game plainly', () => {
      // Arrange
      const state: GameState = {
        ...createInitialState(false, 1111),
        phase: 'game_over',
        winner: 0,
        winCondition: 'prestige',
      };

      // Act
      const result = applyAction(state, { type: 'PASS_MANDATORY' });

      // Assert
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected rejection');
      expect(result.error.reason).toMatch(/game is over/i);
    });

    it('explains a discard the player cannot make', () => {
      // Arrange
      const base = createInitialState(false, 1212);
      const state: GameState = {
        ...base,
        phase: 'discard',
        players: [makePlayer({ tokens: { ...emptyPool(), red: 11 } }), makePlayer()],
      };

      // Act — discarding a colour they do not hold.
      const result = applyAction(state, { type: 'DISCARD_TOKENS', color: 'blue' });

      // Assert
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected rejection');
      expect(result.error.reason).toMatch(/none of those/i);
    });
  });

  // Every rejection reaches a player, so none may be an empty string or the
  // bare fallback when the engine could have been specific.
  describe('rejection reasons are usable', () => {
    it('always produces a non-empty, sentence-like reason', () => {
      // Arrange
      const state = createInitialState(true, 1313);
      const illegal = [
        { type: 'DISCARD_TOKENS', color: 'red' },
        { type: 'CHOOSE_ROYAL_CARD', cardId: 1 },
        { type: 'ASSIGN_WILD_COLOR', wildCardId: 1, color: 'red' },
        { type: 'TAKE_TOKEN_FROM_OPPONENT', color: 'red' },
        { type: 'TAKE_TOKEN_FROM_BOARD', index: 0 },
      ];

      // Act / Assert
      for (const action of illegal) {
        const result = applyAction(state, action);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('expected rejection');
        expect(result.error.reason.trim().length).toBeGreaterThan(10);
        expect(result.error.reason.endsWith('.')).toBe(true);
      }
    });
  });
});
