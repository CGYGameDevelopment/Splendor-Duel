import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  createInitialState,
  reducer,
  legalMoves,
} from '@splendor-duel/game-engine';
import * as store from './simStore';

const router = Router();

// POST /reset
// Body: { sessionId?: string, secondPlayerGetsPrivilege?: boolean }
// Returns: { sessionId, state, legalMoves }
router.post('/reset', (req, res) => {
  const sessionId: string = req.body.sessionId ?? uuidv4();
  const secondPlayerGetsPrivilege: boolean =
    req.body.secondPlayerGetsPrivilege ?? true;

  const state = createInitialState(secondPlayerGetsPrivilege);
  store.set(sessionId, state);
  const moves = legalMoves(state);

  res.json({ sessionId, state, legalMoves: moves });
});

// POST /step
// Body: { sessionId, action }
// Returns: { state, legalMoves, done, winner }
router.post('/step', (req, res) => {
  const { sessionId, action } = req.body;
  const state = store.get(sessionId);

  if (!state) {
    res.status(404).json({ error: `No session: ${sessionId}` });
    return;
  }

  const nextState = reducer(state, action);
  store.set(sessionId, nextState);
  const moves = legalMoves(nextState);
  const done = nextState.phase === 'game_over';

  res.json({
    state: nextState,
    legalMoves: moves,
    done,
    winner: nextState.winner,
  });
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

// GET /health
router.get('/health', (_req, res) => {
  res.json({ ok: true, sessions: store.size() });
});

export default router;
