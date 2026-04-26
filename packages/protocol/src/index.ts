import type { GameState, PlayerState, Action } from '@splendor-duel/game-engine';

// ─── Sanitized state sent over the wire ──────────────────────────────────────

/**
 * Player state as seen by a specific client.
 * Own player: reservedCards contains the actual cards.
 * Opponent: reservedCards is empty; reservedCardCount carries the count.
 */
export type ClientPlayerState = Omit<PlayerState, 'reservedCards'> & {
  reservedCards: PlayerState['reservedCards'];
  reservedCardCount: number;
};

export type ClientGameState = Omit<GameState, 'players'> & {
  players: [ClientPlayerState, ClientPlayerState];
};

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
  | { type: 'UNDO_TURN' }
  | { type: 'PING' };

// ─── Server → Client (WebSocket) ─────────────────────────────────────────────

export type ServerMessage =
  /** Sent to player 0 after they create a session. */
  | { type: 'SESSION_CREATED'; sessionId: string; playerId: 0 }
  /** Sent to player 1 after they successfully join. */
  | { type: 'SESSION_JOINED'; sessionId: string; playerId: 1; state: ClientGameState; canUndo: boolean }
  /** Sent to player 0 when player 1 connects, confirming the game can start. */
  | { type: 'GAME_STARTED'; state: ClientGameState; opponentName: string; canUndo: boolean }
  /** Sent to each player individually after every valid action. */
  | { type: 'STATE_UPDATE'; state: ClientGameState; canUndo: boolean }
  /** Sent to the remaining player when the other disconnects mid-game. */
  | { type: 'OPPONENT_DISCONNECTED' }
  | { type: 'ERROR'; message: string }
  | { type: 'PONG' };
