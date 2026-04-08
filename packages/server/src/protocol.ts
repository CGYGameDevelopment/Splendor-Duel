import type { GameState, Action, PlayerId } from '@splendor-duel/game-engine';

// ─── HTTP ─────────────────────────────────────────────────────────────────────

export interface SessionInfo {
  sessionId: string;
  status: 'waiting' | 'playing' | 'finished';
  playerCount: 1 | 2;
  hostName: string;
}

// ─── Client → Server (WebSocket) ─────────────────────────────────────────────

export type ClientMessage =
  | { type: 'CREATE_SESSION'; playerName: string }
  | { type: 'JOIN_SESSION'; sessionId: string; playerName: string }
  | { type: 'DISPATCH_ACTION'; action: Action }
  | { type: 'PING' };

// ─── Server → Client (WebSocket) ─────────────────────────────────────────────

export type ServerMessage =
  /** Sent to player 0 after they create a session. */
  | { type: 'SESSION_CREATED'; sessionId: string; playerId: 0 }
  /** Sent to player 1 after they successfully join. */
  | { type: 'SESSION_JOINED'; sessionId: string; playerId: 1; state: GameState }
  /** Sent to player 0 when player 1 connects, confirming the game can start. */
  | { type: 'GAME_STARTED'; state: GameState; opponentName: string }
  /** Broadcast to both players after every valid action. */
  | { type: 'STATE_UPDATE'; state: GameState }
  /** Sent to the remaining player when the other disconnects mid-game. */
  | { type: 'OPPONENT_DISCONNECTED' }
  | { type: 'ERROR'; message: string }
  | { type: 'PONG' };
