import WebSocket from 'ws';
import { createInitialState, reducer } from '@splendor-duel/game-engine';
import type { Action, PlayerId } from '@splendor-duel/game-engine';
import type { ClientGameState, ServerMessage, SessionInfo } from '@splendor-duel/protocol';

// ─── Internal session shape ───────────────────────────────────────────────────

interface Session {
  id: string;
  state: ReturnType<typeof createInitialState>;
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

/**
 * Returns a sanitized view of the game state for the given player.
 * The requesting player sees their own reserved cards in full.
 * The opponent's reserved cards are hidden: reservedCards is set to [] and
 * reservedCardCount carries the true count.
 */
function sanitizeStateFor(
  state: ReturnType<typeof createInitialState>,
  viewerId: PlayerId
): ClientGameState {
  const players = state.players.map((p, i) => ({
    ...p,
    reservedCards: i === viewerId ? p.reservedCards : [],
    reservedCardCount: p.reservedCards.length,
  })) as [ClientGameState['players'][0], ClientGameState['players'][1]];
  return { ...state, players };
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
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
export function createSession(playerName: string, ws: WebSocket): string | null {
  const sanitized = sanitizeName(playerName);
  if (!sanitized) {
    send(ws, { type: 'ERROR', message: 'Invalid player name' });
    return null;
  }
  playerName = sanitized;
  const id = generateSessionId();
  const session: Session = {
    id,
    state: createInitialState(true),
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
  playerName: string,
  ws: WebSocket
): PlayerId | null {
  const sanitized = sanitizeName(playerName);
  if (!sanitized) {
    send(ws, { type: 'ERROR', message: 'Invalid player name' });
    return null;
  }
  playerName = sanitized;
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
  send(ws, { type: 'SESSION_JOINED', sessionId, playerId: 1, state: sanitizeStateFor(session.state, 1) });

  // Tell player 0 the opponent arrived and the game is starting (their own reserved cards visible)
  const p0 = session.connections[0];
  if (p0) {
    send(p0, { type: 'GAME_STARTED', state: sanitizeStateFor(session.state, 0), opponentName: playerName });
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

  const nextState = reducer(session.state, action);
  if (nextState === session.state) {
    // Reducer returns the same reference for illegal moves
    send(ws, { type: 'ERROR', message: 'Invalid action' });
    return;
  }

  session.state = nextState;
  if (nextState.phase === 'game_over') {
    session.status = 'finished';
    scheduleCleanup(session);
  }

  for (const pid of [0, 1] as PlayerId[]) {
    const playerWs = session.connections[pid];
    if (playerWs) send(playerWs, { type: 'STATE_UPDATE', state: sanitizeStateFor(nextState, pid) });
  }
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
