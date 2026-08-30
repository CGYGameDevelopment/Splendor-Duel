import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  createInitialState,
  reducer,
  legalMoves,
} from '@splendor-duel/game-engine';
import type { Action, GameState } from '@splendor-duel/game-engine';
import * as store from './simStore';

const router = Router();

/**
 * Upper bound on consecutive forced moves applied by autoAdvance.  A correct
 * engine cannot loop here (every forced move consumes a phase or a resource),
 * so hitting the cap means a rule bug; we stop rather than hang the request.
 */
const MAX_FORCED_MOVES = 64;

/**
 * Strip the undrawn deck arrays down to counts.
 *
 * The trainer's state encoder only ever reads the deck *sizes*, but the full
 * card arrays were 71.5% of every response body (8,819 of 12,332 bytes), paid
 * on every decision of every game.  Compact responses carry deckCounts instead.
 *
 * A compact state is for observation only -- it can no longer be fed back into
 * the engine, so /legal-moves-from-state and any caller that round-trips a
 * state must keep using the full form.
 */
function compactState(state: GameState) {
  const { decks, ...rest } = state;
  return {
    ...rest,
    deckCounts: {
      level1: decks.level1.length,
      level2: decks.level2.length,
      level3: decks.level3.length,
    },
  };
}

interface Advanced {
  state: GameState;
  moves: Action[];
  /** Number of forced moves applied on the caller's behalf. */
  forced: number;
}

/**
 * Apply every move that the player has no choice about.
 *
 * A turn in Splendor Duel spans several phases, and most of them routinely
 * offer exactly one legal move (END_OPTIONAL_PHASE with no privileges to
 * spend, PASS_MANDATORY with nothing playable, a single forced discard).
 * Asking the policy to "choose" between one option teaches it nothing but
 * lengthens every episode -- measured at ~346 steps per game, which puts the
 * terminal reward far outside any usable credit-assignment horizon.
 *
 * Collapsing them here shortens trajectories without changing the game: a
 * state with one legal move has no decision in it.
 */
function autoAdvance(state: GameState, enabled: boolean): Advanced {
  let current = state;
  let moves = legalMoves(current);
  let forced = 0;

  if (!enabled) return { state: current, moves, forced };

  while (
    moves.length === 1 &&
    current.phase !== 'game_over' &&
    forced < MAX_FORCED_MOVES
  ) {
    current = reducer(current, moves[0]);
    moves = legalMoves(current);
    forced += 1;
  }

  return { state: current, moves, forced };
}

function stepResult(
  state: GameState,
  action: Action,
  autoAdvanceEnabled: boolean,
  compact: boolean
) {
  const advanced = autoAdvance(reducer(state, action), autoAdvanceEnabled);
  return {
    state: compact ? compactState(advanced.state) : advanced.state,
    legalMoves: advanced.moves,
    done: advanced.state.phase === 'game_over',
    winner: advanced.state.winner,
    forced: advanced.forced,
    // The caller never sees the full state in compact mode, so the engine's own
    // copy stays the source of truth; this is what gets stored.
    _store: advanced.state,
  };
}

function withoutStore<T extends { _store: GameState }>(result: T) {
  const { _store, ...rest } = result;
  return rest;
}

function newGame(secondPlayerGetsPrivilege: boolean, autoAdvanceEnabled: boolean) {
  return autoAdvance(createInitialState(secondPlayerGetsPrivilege), autoAdvanceEnabled);
}

// POST /reset
// Body: { sessionId?: string, secondPlayerGetsPrivilege?: boolean, autoAdvance?: boolean }
// Returns: { sessionId, state, legalMoves }
router.post('/reset', (req, res) => {
  const sessionId: string = req.body.sessionId ?? uuidv4();
  const secondPlayerGetsPrivilege: boolean =
    req.body.secondPlayerGetsPrivilege ?? true;
  const autoAdvanceEnabled: boolean = req.body.autoAdvance ?? true;
  const compact: boolean = req.body.compact ?? false;

  const advanced = newGame(secondPlayerGetsPrivilege, autoAdvanceEnabled);
  store.set(sessionId, advanced.state);

  res.json({
    sessionId,
    state: compact ? compactState(advanced.state) : advanced.state,
    legalMoves: advanced.moves,
  });
});

// POST /reset-batch
// Body: { sessionIds?: string[], count?: number, secondPlayerGetsPrivilege?: boolean,
//         autoAdvance?: boolean }
// Returns: { results: [{ sessionId, state, legalMoves }] }
//
// One round trip instead of N.  The training loop resets tens of games at a
// time and per-action HTTP latency, not compute, is the throughput ceiling.
router.post('/reset-batch', (req, res) => {
  const { sessionIds, count } = req.body;
  const secondPlayerGetsPrivilege: boolean =
    req.body.secondPlayerGetsPrivilege ?? true;
  const autoAdvanceEnabled: boolean = req.body.autoAdvance ?? true;
  const compact: boolean = req.body.compact ?? false;

  let ids: string[];
  if (Array.isArray(sessionIds)) {
    ids = sessionIds.map((id: unknown) => (typeof id === 'string' ? id : uuidv4()));
  } else if (typeof count === 'number' && count > 0) {
    ids = Array.from({ length: count }, () => uuidv4());
  } else {
    res.status(400).json({ error: 'Provide either sessionIds[] or a positive count' });
    return;
  }

  const results = ids.map(sessionId => {
    const advanced = newGame(secondPlayerGetsPrivilege, autoAdvanceEnabled);
    store.set(sessionId, advanced.state);
    return {
      sessionId,
      state: compact ? compactState(advanced.state) : advanced.state,
      legalMoves: advanced.moves,
    };
  });

  res.json({ results });
});

// POST /step
// Body: { sessionId, action, autoAdvance?: boolean }
// Returns: { state, legalMoves, done, winner, forced }
router.post('/step', (req, res) => {
  const { sessionId, action } = req.body;
  const autoAdvanceEnabled: boolean = req.body.autoAdvance ?? true;
  const compact: boolean = req.body.compact ?? false;

  if (!action) {
    res.status(400).json({ error: 'Missing action in request body' });
    return;
  }

  const state = store.get(sessionId);

  if (!state) {
    res.status(404).json({ error: `No session: ${sessionId}` });
    return;
  }

  const result = stepResult(state, action, autoAdvanceEnabled, compact);
  store.set(sessionId, result._store);

  res.json(withoutStore(result));
});

// POST /step-batch
// Body: { steps: [{ sessionId, action }], autoAdvance?: boolean }
// Returns: { results: [{ sessionId, state, legalMoves, done, winner, forced, error? }] }
//
// Results are returned in request order.  A failure on one session (unknown id,
// illegal action) is reported inline as { sessionId, error } rather than
// failing the whole batch, so one bad env cannot stall a rollout.
router.post('/step-batch', (req, res) => {
  const { steps } = req.body;
  const autoAdvanceEnabled: boolean = req.body.autoAdvance ?? true;
  const compact: boolean = req.body.compact ?? false;

  if (!Array.isArray(steps)) {
    res.status(400).json({ error: 'Missing steps[] in request body' });
    return;
  }

  const results = steps.map((entry: { sessionId?: string; action?: Action }) => {
    const { sessionId, action } = entry ?? {};
    if (!sessionId || !action) {
      return { sessionId, error: 'Each step needs a sessionId and an action' };
    }
    const state = store.get(sessionId);
    if (!state) {
      return { sessionId, error: `No session: ${sessionId}` };
    }
    try {
      const result = stepResult(state, action, autoAdvanceEnabled, compact);
      store.set(sessionId, result._store);
      return { sessionId, ...withoutStore(result) };
    } catch (err) {
      return { sessionId, error: err instanceof Error ? err.message : String(err) };
    }
  });

  res.json({ results });
});

// POST /legal-moves
// Body: { sessionId }
// Returns: { legalMoves }
router.post('/legal-moves', (req, res) => {
  const { sessionId } = req.body;
  const state = store.get(sessionId);

  if (!state) {
    res.status(404).json({ error: `No session: ${sessionId}` });
    return;
  }

  res.json({ legalMoves: legalMoves(state) });
});

// POST /legal-moves-from-state
// Body: { state: GameState }
// Returns: { legalMoves }
router.post('/legal-moves-from-state', (req, res) => {
  const { state } = req.body;
  if (!state) {
    res.status(400).json({ error: 'Missing state in request body' });
    return;
  }
  res.json({ legalMoves: legalMoves(state) });
});

// DELETE /session/:id
router.delete('/session/:id', (req, res) => {
  store.remove(req.params.id);
  res.json({ ok: true });
});

// POST /sessions/close-batch
// Body: { sessionIds: string[] }
router.post('/sessions/close-batch', (req, res) => {
  const { sessionIds } = req.body;
  if (!Array.isArray(sessionIds)) {
    res.status(400).json({ error: 'Missing sessionIds[] in request body' });
    return;
  }
  for (const id of sessionIds) {
    if (typeof id === 'string') store.remove(id);
  }
  res.json({ ok: true });
});

// GET /health
router.get('/health', (_req, res) => {
  res.json({ ok: true, sessions: store.size() });
});

export default router;
