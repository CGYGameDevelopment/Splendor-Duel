import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { createInitialState, applyAction } from '@splendor-duel/game-engine';
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
  /**
   * Per-seat secret that lets a client reclaim its seat after a reload.
   *
   * Scoped to the seat rather than the session so holding one proves *which*
   * player you were; a session-wide token would let either client claim either
   * seat, and with it the other player's hidden reserved cards.
   */
  reconnectTokens: [string, string | null];
  status: 'waiting' | 'playing' | 'finished';
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  /** Set while a player is disconnected and their seat is being held open. */
  abandonTimer: ReturnType<typeof setTimeout> | null;
}

const FINISHED_SESSION_TTL_MS = 60_000; // 1 minute

/**
 * How long a seat is held after a disconnect.
 *
 * A dropped connection used to end the game permanently: handleDisconnect
 * deleted the session once both sockets were gone, and joinSession rejects
 * anything not in the `waiting` state, so a browser refresh was fatal. Two
 * minutes covers a reload, a brief network drop or a laptop lid.
 */
const RECONNECT_GRACE_MS = 120_000;

function scheduleCleanup(session: Session): void {
  if (session.cleanupTimer !== null) return;
  session.cleanupTimer = setTimeout(() => {
    sessions.delete(session.id);
  }, FINISHED_SESSION_TTL_MS);
}

const sessions = new Map<string, Session>();

/**
 * A reconnect secret.
 *
 * randomUUID is used rather than Math.random: this value is the only thing
 * standing between a stranger and someone else's seat, and session ids are only
 * four digits, so a guessable token would make the whole scheme pointless.
 */
function generateReconnectToken(): string {
  return randomUUID();
}

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
  const reconnectToken = generateReconnectToken();
  const session: Session = {
    id,
    state: initial,
    turnStartState: initial,
    hasActionsThisTurn: false,
    connections: [ws, null],
    playerNames: [playerName, null],
    reconnectTokens: [reconnectToken, null],
    status: 'waiting',
    cleanupTimer: null,
    abandonTimer: null,
  };
  sessions.set(id, session);
  send(ws, { type: 'SESSION_CREATED', sessionId: id, playerId: 0, reconnectToken });
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

  const reconnectToken = generateReconnectToken();
  session.connections[1] = ws;
  session.playerNames[1] = playerName;
  session.reconnectTokens[1] = reconnectToken;
  session.status = 'playing';

  // Tell player 1 their identity and the starting state (their own reserved cards visible)
  send(ws, {
    type: 'SESSION_JOINED',
    sessionId,
    playerId: 1,
    state: toClientState(session.state, 1),
    canUndo: canUndoFor(session, 1),
    reconnectToken,
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

  const previousPlayer = session.state.currentPlayer;

  // applyAction validates the payload, applies it and explains any rejection.
  // The engine owns that contract now, so the server no longer compares state
  // references to find out whether its own move landed.
  //
  // The try/catch is for a violated engine invariant (see the crown-milestone
  // and royal-card guards): the reducer throws, and without this the throw would
  // escape the WebSocket message handler and take down the process — and every
  // other live session with it.
  let result: ReturnType<typeof applyAction>;
  try {
    result = applyAction(session.state, action);
  } catch (err) {
    console.error(`Engine error (session=${session.id}, player=${playerId}):`, err);
    send(ws, { type: 'ERROR', message: 'Internal engine error; the game state was not changed' });
    return;
  }

  if (!result.ok) {
    send(ws, { type: 'ERROR', message: result.error.reason });
    return;
  }
  const nextState = result.state;

  session.state = nextState;
  session.hasActionsThisTurn = true;

  // If the turn just switched (or game ended), capture a fresh snapshot for the new current player.
  if (nextState.currentPlayer !== previousPlayer || nextState.phase === 'game_over') {
    session.turnStartState = nextState;
    session.hasActionsThisTurn = false;
  }

  if (nextState.phase === 'game_over') {
    session.status = 'finished';
    if (session.abandonTimer !== null) {
      clearTimeout(session.abandonTimer);
      session.abandonTimer = null;
    }
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
 * Reclaims a seat with the token issued when it was first taken.
 *
 * Returns the seat's PlayerId on success. The token is compared against the
 * specific seat, so a client cannot present player 0's token to claim player 1
 * (and with it sight of their hidden reserved cards).
 */
export function reconnectSession(
  sessionId: string,
  reconnectToken: string,
  ws: WebSocket,
): PlayerId | null {
  const session = sessions.get(sessionId);
  if (!session) {
    send(ws, { type: 'ERROR', message: 'Session not found' });
    return null;
  }

  const seat = ([0, 1] as PlayerId[]).find(
    id => session.reconnectTokens[id] !== null && session.reconnectTokens[id] === reconnectToken,
  );
  if (seat === undefined) {
    send(ws, { type: 'ERROR', message: 'That reconnect token is not valid for this session' });
    return null;
  }

  // Replace whatever is in the seat. A second tab presenting a valid token is
  // the same player moving, so the older socket is dropped rather than refused
  // — refusing would strand a player whose previous socket is half-open.
  const existing = session.connections[seat];
  if (existing && existing !== ws && existing.readyState === WebSocket.OPEN) {
    existing.close();
  }
  session.connections[seat] = ws;

  // The seat is occupied again, so stop holding the session for abandonment.
  if (session.abandonTimer !== null) {
    clearTimeout(session.abandonTimer);
    session.abandonTimer = null;
  }

  const opponentId = (1 - seat) as PlayerId;
  send(ws, {
    type: 'SESSION_RESUMED',
    sessionId,
    playerId: seat,
    state: toClientState(session.state, seat),
    canUndo: canUndoFor(session, seat),
    opponentName: session.playerNames[opponentId],
    opponentConnected: session.connections[opponentId] !== null,
  });

  const opponentWs = session.connections[opponentId];
  if (opponentWs) send(opponentWs, { type: 'OPPONENT_RECONNECTED' });

  return seat;
}

/**
 * Called when a WebSocket closes.
 *
 * The seat is vacated but the session is kept for RECONNECT_GRACE_MS, so a
 * reload or a brief network drop does not end the game. Only when nobody has
 * come back within the grace period is it discarded.
 */
export function handleDisconnect(sessionId: string, playerId: PlayerId): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.connections[playerId] = null;

  const oppId = (1 - playerId) as PlayerId;
  const oppWs = session.connections[oppId];
  if (oppWs) {
    send(oppWs, { type: 'OPPONENT_DISCONNECTED', graceMs: RECONNECT_GRACE_MS });
  }

  // A waiting session whose host left has nothing to come back to: no opponent
  // has joined, so there is no game worth holding.
  const hostLeft = session.status === 'waiting' && !session.connections[0];
  if (hostLeft) {
    if (session.cleanupTimer !== null) clearTimeout(session.cleanupTimer);
    if (session.abandonTimer !== null) clearTimeout(session.abandonTimer);
    sessions.delete(sessionId);
    return;
  }

  // A finished session is already on its own short TTL.
  if (session.status === 'finished') return;

  // Hold the seat. The timer is only armed when nobody is connected: while one
  // player is still at the table the game is plainly still live.
  const bothGone = !session.connections[0] && !session.connections[1];
  if (bothGone && session.abandonTimer === null) {
    session.abandonTimer = setTimeout(() => {
      const current = sessions.get(sessionId);
      if (!current) return;
      if (current.connections[0] || current.connections[1]) return; // someone came back
      if (current.cleanupTimer !== null) clearTimeout(current.cleanupTimer);
      sessions.delete(sessionId);
    }, RECONNECT_GRACE_MS);
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
