import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import { createInitialState, reducer } from '@splendor-duel/game-engine';
import type { Action, PlayerId } from '@splendor-duel/game-engine';
import type { ServerMessage, SessionInfo } from './protocol';

// ─── Internal session shape ───────────────────────────────────────────────────

interface Session {
  id: string;
  state: ReturnType<typeof createInitialState>;
  connections: [WebSocket | null, WebSocket | null];
  playerNames: [string, string | null];
  status: 'waiting' | 'playing' | 'finished';
}

const sessions = new Map<string, Session>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(session: Session, msg: ServerMessage): void {
  for (const ws of session.connections) {
    if (ws) send(ws, msg);
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
  const id = uuidv4();
  const session: Session = {
    id,
    state: createInitialState(true),
    connections: [ws, null],
    playerNames: [playerName, null],
    status: 'waiting',
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

  // Tell player 1 their identity and the starting state
  send(ws, { type: 'SESSION_JOINED', sessionId, playerId: 1, state: session.state });

  // Tell player 0 the opponent arrived and the game is starting
  const p0 = session.connections[0];
  if (p0) {
    send(p0, { type: 'GAME_STARTED', state: session.state, opponentName: playerName });
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
  }

  broadcast(session, { type: 'STATE_UPDATE', state: nextState });
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
  if (!session.connections[0] && !session.connections[1]) {
    sessions.delete(sessionId);
  } else if (session.status === 'waiting' && !session.connections[0]) {
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
