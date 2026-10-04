import { useCallback, useMemo, useState } from 'react';
import { createInitialState, reducer, legalMoves, randomInt } from '@splendor-duel/game-engine';
import type { Action, GameState, PlayerId } from '@splendor-duel/game-engine';
import { toClientState } from '@splendor-duel/protocol';
import type { GameSession } from '../connection/useGameSession';

/**
 * A fabricated mid-game session for visual development.
 *
 * Styling the board used to mean starting the server, opening two browsers and
 * playing far enough in to see purchased cards, reserved cards, royals and a
 * partly-drained board. That is slow, and the position differs every time.
 *
 * Instead this plays a seeded game forward with the real engine, so the UI
 * renders genuine state with every area populated — and the same seed always
 * produces the same screen, which is what makes a visual comparison meaningful.
 *
 * Dev-only: App.tsx reaches it behind `import.meta.env.DEV` through a dynamic
 * import, so it stays out of the production bundle.
 */

export interface DemoOptions {
  /**
   * Seed for both the game setup and the move choices.
   *
   * The default was picked by searching seeds for a position that exercises the
   * whole screen: a mostly-full board with gold still on it, purchased and
   * reserved cards on both sides, a crown already taken, and affordable cards
   * in the pyramid so the availability rings are visible. A uniform walk lands
   * on a drained board with nothing buyable, which flatters the UI by hiding
   * most of it.
   */
  seed?: number;
  /** How many legal moves to play before handing the state to the UI. */
  steps?: number;
  /** Which seat the viewer occupies. */
  viewer?: PlayerId;
}

/** Move types that populate the parts of the screen worth looking at. */
const INTERESTING_MOVES = new Set<Action['type']>([
  'PURCHASE_CARD',
  'RESERVE_CARD_FROM_PYRAMID',
  'RESERVE_CARD_FROM_DECK',
]);

/** Plays `steps` legal moves, preferring ones that make the UI more interesting. */
function playForward(seed: number, steps: number): GameState {
  let state = createInitialState(true, seed);
  let choiceSeed = seed ^ 0x9e3779b9;

  for (let step = 0; step < steps && state.phase !== 'game_over'; step++) {
    const moves = legalMoves(state);
    if (moves.length === 0) break;

    // Weighted towards buying and reserving: a uniform walk mostly takes
    // tokens, which leaves every card area empty. Not always, though — always
    // buying drains the pools and hides the take-token affordances.
    const preferred = moves.filter(move => INTERESTING_MOVES.has(move.type));
    const roll = randomInt(choiceSeed, 100);
    choiceSeed = roll.seed;
    const pool = preferred.length > 0 && roll.value < 70 ? preferred : moves;

    const pick = randomInt(choiceSeed, pool.length);
    choiceSeed = pick.seed;
    state = reducer(state, pool[pick.value]);
  }

  return state;
}

/**
 * A GameSession backed by the real reducer instead of a server.
 *
 * The harness is genuinely playable: hover states, token selection and the
 * modals all behave as they do in a real game. Undo is the one exception — it
 * needs the turn-start snapshot that only the server keeps.
 */
export function useDemoSession({
  seed = 361,
  steps = 30,
  viewer = 0,
}: DemoOptions = {}): GameSession {
  const [engineState, setEngineState] = useState<GameState>(() => playForward(seed, steps));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const dispatch = useCallback((action: Action) => {
    setEngineState(previous => {
      const next = reducer(previous, action);
      setErrorMessage(next === previous ? 'Illegal move in the current phase' : null);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setEngineState(playForward(seed, steps));
    setErrorMessage(null);
  }, [seed, steps]);

  const clientState = useMemo(() => toClientState(engineState, viewer), [engineState, viewer]);

  return {
    info: {
      status: engineState.phase === 'game_over' ? 'game_over' : 'in_game',
      sessionId: 'DEMO',
      playerId: viewer,
      playerName: 'You',
      opponentName: 'Adversary',
      state: clientState,
      canUndo: false,
      errorMessage,
    },
    connectAndCreate: () => undefined,
    connectAndJoin: () => undefined,
    dispatch,
    undo: () => undefined,
    reset,
  };
}
