import WebSocket from 'ws';
import type { Action, PlayerId } from '@splendor-duel/game-engine';
import type { SessionInfo } from './protocol';
/**
 * Creates a new session with player 0 already connected.
 * Returns the generated session ID.
 */
export declare function createSession(playerName: string, ws: WebSocket): string | null;
/**
 * Joins an existing session as player 1.
 * Notifies both players on success.
 * Returns the assigned PlayerId or null on failure.
 */
export declare function joinSession(sessionId: string, playerName: string, ws: WebSocket): PlayerId | null;
/**
 * Applies an action dispatched by a player.
 * Broadcasts the resulting state to both players if the action is valid.
 */
export declare function dispatchAction(sessionId: string, playerId: PlayerId, action: Action, ws: WebSocket): void;
/**
 * Called when a WebSocket closes.
 * Notifies the other player and cleans up fully-disconnected sessions.
 */
export declare function handleDisconnect(sessionId: string, playerId: PlayerId): void;
/** Returns open (waiting/playing) sessions suitable for a lobby listing. */
export declare function listSessions(): SessionInfo[];
//# sourceMappingURL=sessionManager.d.ts.map