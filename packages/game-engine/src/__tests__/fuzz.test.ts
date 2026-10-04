import { createInitialState } from '../initialState';
import { reducer } from '../reducer';
import { legalMoves } from '../legalMoves';
import { randomInt } from '../rng';
import type { Action, GameState } from '../types';
import { assertStateInvariants } from './invariants';

/**
 * Randomised full-game playthroughs.
 *
 * The unit tests in reducer.test.ts each drive one transition from a hand-built
 * state. That catches the cases someone thought to write down; it cannot catch a
 * rule interaction nobody anticipated — a sequence of abilities, a crown
 * milestone landing mid-ability, a discard forced during a repeated turn.
 *
 * This suite plays whole games by choosing uniformly from `legalMoves` and
 * checks every invariant after every single step. A failure prints the seed and
 * the action sequence, so any game it finds is reproducible exactly: the engine
 * is deterministic given a seed (see rng.ts), which is what makes this useful
 * rather than merely flaky.
 */

/** A game is a bug, not a long game, past this many steps. */
const MAX_STEPS = 2_000;
/** How many independent games each property is checked over. */
const GAMES = 150;

interface Playthrough {
  seed: number;
  steps: number;
  finalState: GameState;
  history: Action[];
}

/** Plays one game to completion, asserting invariants after every transition. */
function playGame(seed: number, onStep?: (before: GameState, action: Action, after: GameState) => void): Playthrough {
  let state = createInitialState(seed % 2 === 0, seed);
  let choiceSeed = seed ^ 0x5f3759df;
  const history: Action[] = [];
  let steps = 0;

  const describe = (): string =>
    `seed=${seed} steps=${steps} history=${JSON.stringify(history.slice(-12))}`;

  try {
    assertStateInvariants(state, `initial state, seed=${seed}`);
  } catch (err) {
    throw new Error(`${(err as Error).message}\n  ${describe()}`);
  }

  while (state.phase !== 'game_over' && steps < MAX_STEPS) {
    const moves = legalMoves(state);

    if (moves.length === 0) {
      throw new Error(`No legal moves in phase "${state.phase}" but the game is not over\n  ${describe()}`);
    }

    const drawn = randomInt(choiceSeed, moves.length);
    choiceSeed = drawn.seed;
    const action = moves[drawn.value];

    const before = state;
    let after: GameState;
    try {
      after = reducer(before, action);
    } catch (err) {
      throw new Error(`Reducer threw on ${JSON.stringify(action)}: ${(err as Error).message}\n  ${describe()}`);
    }

    if (after === before) {
      throw new Error(
        `legalMoves offered ${JSON.stringify(action)} but the reducer rejected it ` +
        `in phase "${before.phase}"\n  ${describe()}`,
      );
    }

    history.push(action);
    steps += 1;
    state = after;

    try {
      assertStateInvariants(state, `after ${action.type}`);
    } catch (err) {
      throw new Error(`${(err as Error).message}\n  ${describe()}`);
    }

    onStep?.(before, action, state);
  }

  return { seed, steps, finalState: state, history };
}

const SEEDS = Array.from({ length: GAMES }, (_, index) => index * 7919 + 13);

describe('randomised playthroughs', () => {
  it('holds every state invariant across whole games', () => {
    // Arrange / Act / Assert — playGame throws with a reproducing seed on any
    // violation, so reaching the end is the assertion.
    for (const seed of SEEDS) {
      expect(() => playGame(seed)).not.toThrow();
    }
  });

  it('always terminates, and always in game_over', () => {
    // Arrange / Act
    const results = SEEDS.map(seed => playGame(seed));

    // Assert
    for (const result of results) {
      expect(result.steps).toBeLessThan(MAX_STEPS);
      expect(result.finalState.phase).toBe('game_over');
      expect(result.finalState.winner).not.toBeNull();
      expect(result.finalState.winCondition).not.toBeNull();
    }
  });

  it('ends on a winner who actually meets the declared condition', () => {
    // Arrange / Act
    const results = SEEDS.map(seed => playGame(seed));

    // Assert
    for (const { finalState, seed } of results) {
      const winner = finalState.players[finalState.winner as 0 | 1];
      const byColor = new Map<string, number>();
      for (const card of winner.purchasedCards) {
        const color = card.assignedColor ?? card.color;
        if (color) byColor.set(color, (byColor.get(color) ?? 0) + card.points);
      }
      const bestColor = Math.max(0, ...byColor.values());

      const meetsCondition =
        winner.prestige >= 20 || winner.crowns >= 10 || bestColor >= 10;

      expect(meetsCondition).toBe(true);

      // And the recorded condition is one the winner genuinely satisfies.
      const satisfied = {
        prestige: winner.prestige >= 20,
        crowns: winner.crowns >= 10,
        color_prestige: bestColor >= 10,
      }[finalState.winCondition as 'prestige' | 'crowns' | 'color_prestige'];
      expect(satisfied).toBe(true);
      expect(seed).toBe(seed); // keeps the seed in the failure output
    }
  });

  it('replays identically from the same seed', () => {
    // Arrange / Act
    const first = playGame(SEEDS[0]);
    const second = playGame(SEEDS[0]);

    // Assert — same choices, same draws, same outcome.
    expect(second.history).toEqual(first.history);
    expect(second.steps).toBe(first.steps);
    expect(second.finalState).toEqual(first.finalState);
  });

  // legalMoves once filtered out every card that needed gold, before computing a
  // gold allocation for it — so gold was never spendable on a purchase and the
  // allocation code was unreachable. Nothing failed: games still completed, just
  // without that rule. Asserting the corpus exercises it keeps that silent.
  it('exercises gold-funded purchases across the corpus', () => {
    // Arrange
    let goldFundedPurchases = 0;

    // Act
    for (const seed of SEEDS) {
      const { history } = playGame(seed);
      for (const action of history) {
        if (action.type !== 'PURCHASE_CARD') continue;
        const spent = Object.values(action.goldUsage).reduce<number>(
          (sum, amount) => sum + (amount ?? 0), 0,
        );
        if (spent > 0) goldFundedPurchases += 1;
      }
    }

    // Assert
    expect(goldFundedPurchases).toBeGreaterThan(0);
  });

  it('reaches every phase across the corpus, so the invariants are not vacuous', () => {
    // Arrange
    const seen = new Set<string>();

    // Act
    for (const seed of SEEDS) {
      playGame(seed, (_before, _action, after) => { seen.add(after.phase); });
    }

    // Assert — a corpus that never entered discard or resolve_ability would be
    // checking far less than it appears to.
    expect(seen).toContain('mandatory');
    expect(seen).toContain('optional_privilege');
    expect(seen).toContain('optional_replenish');
    expect(seen).toContain('discard');
    expect(seen).toContain('resolve_ability');
    expect(seen).toContain('choose_royal');
    expect(seen).toContain('assign_wild');
    expect(seen).toContain('game_over');
  });
});

// ─── Illegal actions are inert ────────────────────────────────────────────────
//
// The reducer's contract is that it returns the *same reference* for any action
// it does not apply. The server relies on this to tell a client its move was
// rejected, so a move that is not in `legalMoves` must never change state.

describe('actions outside legalMoves are inert', () => {
  /** Every action shape the engine accepts, as a candidate pool. */
  function candidateActions(state: GameState): Action[] {
    const colors = ['white', 'blue', 'green', 'red', 'black', 'pearl', 'gold'] as const;
    const gems = ['white', 'blue', 'green', 'red', 'black'] as const;
    const cardIds = [
      ...state.pyramid.level1, ...state.pyramid.level2, ...state.pyramid.level3,
      ...state.players[0].reservedCards, ...state.players[1].reservedCards,
    ].map(card => card.id);

    const actions: Action[] = [
      { type: 'END_OPTIONAL_PHASE' },
      { type: 'SKIP_TO_MANDATORY' },
      { type: 'REPLENISH_BOARD' },
      { type: 'PASS_MANDATORY' },
      { type: 'RESERVE_CARD_FROM_DECK', source: 'deck_1' },
      { type: 'RESERVE_CARD_FROM_DECK', source: 'deck_2' },
      { type: 'RESERVE_CARD_FROM_DECK', source: 'deck_3' },
    ];
    for (let index = 0; index < 25; index++) {
      actions.push({ type: 'USE_PRIVILEGE', index });
      actions.push({ type: 'TAKE_TOKEN_FROM_BOARD', index });
      actions.push({ type: 'TAKE_TOKENS', indices: [index] });
    }
    for (const color of colors) {
      actions.push({ type: 'DISCARD_TOKENS', color });
      actions.push({ type: 'TAKE_TOKEN_FROM_OPPONENT', color });
    }
    // Purchases are probed with an empty gold allocation only. legalMoves emits
    // the *minimal* allocation for each affordable card (see the note in
    // legalMoves.ts on why it does not enumerate gold overpayment), so other
    // allocations are legal-but-unlisted and would fail this property for a
    // reason that is by design rather than a bug. An empty allocation is sound
    // to probe: it is either exactly what legalMoves offered, or it fails
    // canAfford and is correctly inert.
    for (const cardId of cardIds) {
      actions.push({ type: 'PURCHASE_CARD', cardId, goldUsage: {} });
      actions.push({ type: 'RESERVE_CARD_FROM_PYRAMID', cardId });
      for (const color of gems) {
        actions.push({ type: 'ASSIGN_WILD_COLOR', wildCardId: cardId, color });
      }
    }
    for (const card of state.royalDeck) {
      actions.push({ type: 'CHOOSE_ROYAL_CARD', cardId: card.id });
    }
    return actions;
  }

  function key(action: Action): string {
    return JSON.stringify(action);
  }

  it('leaves state untouched for any well-formed action the engine did not offer', () => {
    // Arrange — walk a handful of games and probe every state along the way.
    for (const seed of SEEDS.slice(0, 12)) {
      let state = createInitialState(true, seed);
      let choiceSeed = seed ^ 0x1234567;
      let steps = 0;

      while (state.phase !== 'game_over' && steps < MAX_STEPS) {
        const legal = new Set(legalMoves(state).map(key));

        // Act / Assert — every candidate that is not legal must be inert.
        for (const candidate of candidateActions(state)) {
          if (legal.has(key(candidate))) continue;
          const next = reducer(state, candidate);
          if (next !== state) {
            throw new Error(
              `Illegal action ${key(candidate)} changed state in phase "${state.phase}" ` +
              `(seed=${seed}, step=${steps})`,
            );
          }
        }

        const moves = legalMoves(state);
        const drawn = randomInt(choiceSeed, moves.length);
        choiceSeed = drawn.seed;
        state = reducer(state, moves[drawn.value]);
        steps += 1;
      }
    }
  });

  it('leaves state untouched for malformed payloads', () => {
    // Arrange
    const state = createInitialState(true, 4242);
    const malformed: unknown[] = [
      null,
      {},
      { type: 'NOPE' },
      { type: 'TAKE_TOKENS' },
      { type: 'TAKE_TOKENS', indices: [0, 0] },
      { type: 'TAKE_TOKENS', indices: [0, 1, 2, 3] },
      { type: 'TAKE_TOKENS', indices: [-1] },
      { type: 'USE_PRIVILEGE', index: 99 },
      { type: 'USE_PRIVILEGE', index: 1.5 },
      { type: 'DISCARD_TOKENS', color: 'notacolor' },
      { type: 'TAKE_TOKEN_FROM_OPPONENT', color: 'notacolor' },
      { type: 'PURCHASE_CARD', cardId: 1, goldUsage: { notacolor: 1 } },
      { type: 'PURCHASE_CARD', cardId: 1, goldUsage: { red: -1 } },
      { type: 'PURCHASE_CARD', cardId: 1, goldUsage: { red: NaN } },
      { type: 'ASSIGN_WILD_COLOR', wildCardId: 1, color: 'gold' },
      { type: 'CHOOSE_ROYAL_CARD', cardId: 0 },
    ];

    // Act / Assert
    for (const action of malformed) {
      expect(reducer(state, action as Action)).toBe(state);
    }
  });
});
