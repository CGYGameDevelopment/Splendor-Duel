import { createInitialState, reducer, legalMoves } from '@splendor-duel/game-engine';
import type { GameState } from '@splendor-duel/game-engine';
import { toClientState, withoutHiddenEngineState, deckCountsOf } from '../index';

describe('deckCountsOf', () => {
  it('reports the remaining cards per level', () => {
    // Arrange
    const state = createInitialState(true, 1);

    // Act
    const counts = deckCountsOf(state.decks);

    // Assert
    expect(counts).toEqual({
      level1: state.decks.level1.length,
      level2: state.decks.level2.length,
      level3: state.decks.level3.length,
    });
  });
});

describe('withoutHiddenEngineState', () => {
  it('removes the deck arrays and the PRNG seed', () => {
    // Arrange
    const state = createInitialState(true, 42);

    // Act
    const visible = withoutHiddenEngineState(state);

    // Assert
    expect(visible).not.toHaveProperty('decks');
    expect(visible).not.toHaveProperty('rngSeed');
    expect(visible.deckCounts.level1).toBe(state.decks.level1.length);
  });

  it('keeps the public fields intact', () => {
    // Arrange
    const state = createInitialState(true, 42);

    // Act
    const visible = withoutHiddenEngineState(state);

    // Assert
    expect(visible.board).toEqual(state.board);
    expect(visible.pyramid).toEqual(state.pyramid);
    expect(visible.bag).toEqual(state.bag);
    expect(visible.privileges).toBe(state.privileges);
    expect(visible.currentPlayer).toBe(state.currentPlayer);
    expect(visible.phase).toBe(state.phase);
  });
});

// A client that knows the deck order sees every card that will enter the
// pyramid; a client that knows the PRNG seed can predict exactly which tokens a
// replenish will place. Neither may cross the wire.
describe('toClientState hides secret information', () => {
  it('never includes the undrawn deck contents', () => {
    // Arrange
    const state = createInitialState(true, 7);

    // Act
    const view = toClientState(state, 0);

    // Assert
    expect(view).not.toHaveProperty('decks');
    expect(JSON.stringify(view)).not.toContain('"decks"');
  });

  it('never includes the PRNG seed', () => {
    // Arrange
    const state = createInitialState(true, 7);

    // Act
    const view = toClientState(state, 0);

    // Assert
    expect(view).not.toHaveProperty('rngSeed');
    expect(JSON.stringify(view)).not.toContain('rngSeed');
  });

  it('does not leak any deck card id through the serialized view', () => {
    // Arrange — the top card of each deck is the most valuable secret, since it
    // is the next card to enter the pyramid.
    const state = createInitialState(true, 99);
    const view = toClientState(state, 0);
    const visibleCardIds = new Set([
      ...view.pyramid.level1.map(card => card.id),
      ...view.pyramid.level2.map(card => card.id),
      ...view.pyramid.level3.map(card => card.id),
    ]);

    // Act
    const serialized = JSON.parse(JSON.stringify(view));

    // Assert — walk the view and collect every jewel card id it mentions; none
    // may come from a deck.
    //
    // Jewel ids (1..67) and royal ids (1..4) are separate id spaces that overlap
    // by design — the two are separate decks with different gameplay functions —
    // so a bare id is ambiguous: royal cards are face-up on the table and
    // legitimately public. `level` discriminates: only nodes with a numeric
    // level are jewel cards.
    const foundIds: number[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node && typeof node === 'object') {
        const record = node as Record<string, unknown>;
        if (typeof record.id === 'number' && typeof record.level === 'number') {
          foundIds.push(record.id);
        }
        Object.values(record).forEach(walk);
      }
    };
    walk(serialized);

    const deckIds = new Set([
      ...state.decks.level1.map(card => card.id),
      ...state.decks.level2.map(card => card.id),
      ...state.decks.level3.map(card => card.id),
    ]);
    const leaked = foundIds.filter(id => deckIds.has(id) && !visibleCardIds.has(id));
    expect(leaked).toEqual([]);
  });

  it('shows the viewer their own reserved cards and hides the opponent\'s', () => {
    // Arrange — give each player a reserved card by reserving from the pyramid.
    let state: GameState = createInitialState(false, 11);
    const reserveFor = (current: GameState): GameState => {
      const reserve = legalMoves(current).find(move => move.type === 'RESERVE_CARD_FROM_PYRAMID');
      if (!reserve) throw new Error('expected a reserve move to be available');
      return reducer(current, reserve);
    };
    state = reserveFor(state);
    // Walk forward to player 1's mandatory phase and reserve there too.
    while (state.currentPlayer !== 1 || state.phase !== 'mandatory') {
      const moves = legalMoves(state);
      const advance = moves.find(m => m.type === 'SKIP_TO_MANDATORY') ?? moves[0];
      state = reducer(state, advance);
    }
    state = reserveFor(state);

    expect(state.players[0].reservedCards).toHaveLength(1);
    expect(state.players[1].reservedCards).toHaveLength(1);

    // Act
    const viewOfPlayer0 = toClientState(state, 0);
    const viewOfPlayer1 = toClientState(state, 1);

    // Assert
    expect(viewOfPlayer0.players[0].reservedCards).toHaveLength(1);
    expect(viewOfPlayer0.players[1].reservedCards).toHaveLength(0);
    expect(viewOfPlayer0.players[1].reservedCardCount).toBe(1);

    expect(viewOfPlayer1.players[1].reservedCards).toHaveLength(1);
    expect(viewOfPlayer1.players[0].reservedCards).toHaveLength(0);
    expect(viewOfPlayer1.players[0].reservedCardCount).toBe(1);
  });

  it('does not leak an opponent reserved card id through the serialized view', () => {
    // Arrange
    let state: GameState = createInitialState(false, 23);
    const reserve = legalMoves(state).find(move => move.type === 'RESERVE_CARD_FROM_PYRAMID');
    if (!reserve || reserve.type !== 'RESERVE_CARD_FROM_PYRAMID') throw new Error('no reserve move');
    state = reducer(state, reserve);
    const hiddenCardId = state.players[0].reservedCards[0].id;

    // Act — player 1's view of player 0's reserve
    const serialized = JSON.stringify(toClientState(state, 1).players[1]);

    // Assert
    expect(serialized).not.toContain(`"id":${hiddenCardId}`);
  });
});

// The deck-count view exists so a client can enumerate moves itself. If it did
// not produce the same list as the full state, the client would offer moves the
// server rejects.
describe('a client view enumerates the same moves as the full state', () => {
  it('agrees with the engine across a full playthrough', () => {
    // Arrange
    let state: GameState = createInitialState(true, 2026);
    let steps = 0;

    // Act / Assert
    while (state.phase !== 'game_over' && steps < 2000) {
      const fromFullState = legalMoves(state);
      const fromClientView = legalMoves(toClientState(state, state.currentPlayer));

      expect(fromClientView).toEqual(fromFullState);

      state = reducer(state, fromFullState[0]);
      steps += 1;
    }

    expect(steps).toBeLessThan(2000);
  });
});
