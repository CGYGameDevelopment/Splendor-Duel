import WebSocket from 'ws';
import { createInitialState, reducer, validateAction } from '@splendor-duel/game-engine';
import type { Action, PlayerId } from '@splendor-duel/game-engine';
import { toClientState } from '@splendor-duel/protocol';
import type { ServerMessage, SessionInfo } from '@splendor-duel/protocol';

// ─── Internal session shape ───────────────────────────────────────────────────

interface Session {
  id: string;
  state: ReturnType<typeof createInitialState>;
  /** Snapshot of state at the start of the current player's turn — used for UNDO_TURN. */
  turnStartState: ReturnType<typeof createInitialState>;
  /** True iff the current player has dispatched at least one action this turn. */
  hasActionsThisTurn: boolean;
  connections: [WebSocket | null, WebSocket | null];
  playerNames: [string, string | null];
  status: 'waiting' | 'playing' | 'finished';
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

const FINISHED_SESSION_TTL_MS = 60_000; // 1 minute

function scheduleCleanup(session: Session): void {
  if (session.cleanupTimer !== null) return;
  session.cleanupTimer = setTimeout(() => {
    sessions.delete(session.id);
  }, FINISHED_SESSION_TTL_MS);
}

const sessions = new Map<string, Session>();

function generateSessionId(): string {
  let id: string;
  do {
    id = String(Math.floor(Math.random() * 9000) + 1000);
  } while (sessions.has(id));
  return id;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Whether the given player can undo right now.
 * Allowed only when it is their turn AND they have made at least one action since the turn began.
 */
function canUndoFor(session: Session, viewerId: PlayerId): boolean {
  if (session.status !== 'playing') return false;
  if (session.state.phase === 'game_over') return false;
  if (session.state.currentPlayer !== viewerId) return false;
  return session.hasActionsThisTurn;
}

function broadcastState(session: Session, kind: 'STATE_UPDATE' = 'STATE_UPDATE'): void {
  for (const pid of [0, 1] as PlayerId[]) {
    const playerWs = session.connections[pid];
    if (playerWs) {
      send(playerWs, {
        type: kind,
        state: toClientState(session.state, pid),
        canUndo: canUndoFor(session, pid),
      });
    }
  }
}


// ─── Public API ───────────────────────────────────────────────────────────────

const MAX_NAME_LENGTH = 50;

function sanitizeName(name: string): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Creates a new session with player 0 already connected.
 * Returns the generated session ID.
 */
export function createSession(requestedName: string, ws: WebSocket): string | null {
  const playerName = sanitizeName(requestedName);
  if (!playerName) {
    send(ws, { type: 'ERROR', message: 'Invalid player name' });
    return null;
  }
  const id = generateSessionId();
  const initial = createInitialState(true);
  const session: Session = {
    id,
    state: initial,
    turnStartState: initial,
    hasActionsThisTurn: false,
    connections: [ws, null],
    playerNames: [playerName, null],
    status: 'waiting',
    cleanupTimer: null,
  };
  sessions.set(id, session);
  send(ws, { type: 'SESSION_CREATED', sessionId: id, playerId: 0 });
  return id;
}

/**
 * Joins an existing session as player 1.
 * Notifies both players on success.
 * Returns the assigned PlayerId or null on failure.
 */
export function joinSession(
  sessionId: string,
  requestedName: string,
  ws: WebSocket
): PlayerId | null {
  const playerName = sanitizeName(requestedName);
  if (!playerName) {
    send(ws, { type: 'ERROR', message: 'Invalid player name' });
    return null;
  }
  const session = sessions.get(sessionId);
  if (!session) {
    send(ws, { type: 'ERROR', message: 'Session not found' });
    return null;
  }
  if (session.status !== 'waiting') {
    send(ws, { type: 'ERROR', message: 'Session is not open for joining' });
    return null;
  }

  session.connections[1] = ws;
  session.playerNames[1] = playerName;
  session.status = 'playing';

  // Tell player 1 their identity and the starting state (their own reserved cards visible)
  send(ws, {
    type: 'SESSION_JOINED',
    sessionId,
    playerId: 1,
    state: toClientState(session.state, 1),
    canUndo: canUndoFor(session, 1),
  });

  // Tell player 0 the opponent arrived and the game is starting (their own reserved cards visible)
  const p0 = session.connections[0];
  if (p0) {
    send(p0, {
      type: 'GAME_STARTED',
      state: toClientState(session.state, 0),
      opponentName: playerName,
      canUndo: canUndoFor(session, 0),
    });
  }

  return 1;
}

/**
 * Applies an action dispatched by a player.
 * Broadcasts the resulting state to both players if the action is valid.
 */
export function dispatchAction(
  sessionId: string,
  playerId: PlayerId,
  action: Action,
  ws: WebSocket
): void {
  const session = sessions.get(sessionId);
  if (!session) {
    send(ws, { type: 'ERROR', message: 'Session not found' });
    return;
  }
  if (session.status !== 'playing') {
    send(ws, { type: 'ERROR', message: 'Game is not in progress' });
    return;
  }
  if (session.state.phase === 'game_over') {
    send(ws, { type: 'ERROR', message: 'Game is already over' });
    return;
  }
  if (session.state.currentPlayer !== playerId) {
    send(ws, { type: 'ERROR', message: 'Not your turn' });
    return;
  }

  // Shape-check the payload before the rules engine sees it. The action came
  // off the wire, so it is whatever the peer sent; validating here lets us tell
  // the client *why* it was rejected instead of a bare "invalid action".
  const validated = validateAction(action);
  if (!validated.valid) {
    send(ws, { type: 'ERROR', message: `Malformed action: ${validated.error.reason}` });
    return;
  }

  const previousPlayer = session.state.currentPlayer;

  // The reducer throws on a violated engine invariant (see the crown-milestone
  // and royal-card guards). Without this catch the throw would escape the
  // WebSocket message handler and take down the process — and every other live
  // session with it.
  let nextState: Session['state'];
  try {
    nextState = reducer(session.state, validated.action);
  } catch (err) {
    console.error(
      `Engine error (session=${session.id}, player=${playerId}, action=${validated.action.type}):`,
      err,
    );
    send(ws, { type: 'ERROR', message: 'Internal engine error; the game state was not changed' });
    return;
  }

  if (nextState === session.state) {
    // Reducer returns the same reference for a move that is well-formed but
    // not legal in the current phase.
    send(ws, { type: 'ERROR', message: 'Illegal move in the current phase' });
    return;
  }

  session.state = nextState;
  session.hasActionsThisTurn = true;

  // If the turn just switched (or game ended), capture a fresh snapshot for the new current player.
  if (nextState.currentPlayer !== previousPlayer || nextState.phase === 'game_over') {
    session.turnStartState = nextState;
    session.hasActionsThisTurn = false;
  }

  if (nextState.phase === 'game_over') {
    session.status = 'finished';
    scheduleCleanup(session);
  }

  broadcastState(session);
}

/**
 * Restores the state to the start of the current player's turn.
 * Allowed only for the current player and only when at least one action has been dispatched this turn.
 */
export function undoTurn(sessionId: string, playerId: PlayerId, ws: WebSocket): void {
  const session = sessions.get(sessionId);
  if (!session) {
    send(ws, { type: 'ERROR', message: 'Session not found' });
    return;
  }
  if (session.status !== 'playing') {
    send(ws, { type: 'ERROR', message: 'Game is not in progress' });
    return;
  }
  if (session.state.currentPlayer !== playerId) {
    send(ws, { type: 'ERROR', message: 'Not your turn' });
    return;
  }
  if (!session.hasActionsThisTurn) {
    send(ws, { type: 'ERROR', message: 'Nothing to undo' });
    return;
  }

  session.state = session.turnStartState;
  session.hasActionsThisTurn = false;
  broadcastState(session);
}

/**
 * Called when a WebSocket closes.
 * Notifies the other player and cleans up fully-disconnected sessions.
 */
export function handleDisconnect(sessionId: string, playerId: PlayerId): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.connections[playerId] = null;

  const oppId = (1 - playerId) as PlayerId;
  const oppWs = session.connections[oppId];
  if (oppWs) {
    send(oppWs, { type: 'OPPONENT_DISCONNECTED' });
  }

  // Remove sessions with no remaining connections, or waiting sessions where the host left
  const bothGone = !session.connections[0] && !session.connections[1];
  const hostLeft = session.status === 'waiting' && !session.connections[0];
  if (bothGone || hostLeft) {
    if (session.cleanupTimer !== null) clearTimeout(session.cleanupTimer);
    sessions.delete(sessionId);
  }
}

/** Returns open (waiting/playing) sessions suitable for a lobby listing. */
export function listSessions(): SessionInfo[] {
  return Array.from(sessions.values())
    .filter(s => s.status !== 'finished')
    .map(s => ({
      sessionId: s.id,
      status: s.status,
      playerCount: (s.connections.filter(Boolean).length) as 1 | 2,
      hostName: s.playerNames[0],
    }));
}
