"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSession = createSession;
exports.joinSession = joinSession;
exports.dispatchAction = dispatchAction;
exports.undoTurn = undoTurn;
exports.handleDisconnect = handleDisconnect;
exports.listSessions = listSessions;
const ws_1 = __importDefault(require("ws"));
const game_engine_1 = require("@splendor-duel/game-engine");
const FINISHED_SESSION_TTL_MS = 60000; // 1 minute
function scheduleCleanup(session) {
    if (session.cleanupTimer !== null)
        return;
    session.cleanupTimer = setTimeout(() => {
        sessions.delete(session.id);
    }, FINISHED_SESSION_TTL_MS);
}
const sessions = new Map();
function generateSessionId() {
    let id;
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
function sanitizeStateFor(state, viewerId) {
    const players = state.players.map((p, i) => ({
        ...p,
        reservedCards: i === viewerId ? p.reservedCards : [],
        reservedCardCount: p.reservedCards.length,
    }));
    return { ...state, players };
}
function send(ws, msg) {
    if (ws.readyState === ws_1.default.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}
/**
 * Whether the given player can undo right now.
 * Allowed only when it is their turn AND they have made at least one action since the turn began.
 */
function canUndoFor(session, viewerId) {
    if (session.status !== 'playing')
        return false;
    if (session.state.phase === 'game_over')
        return false;
    if (session.state.currentPlayer !== viewerId)
        return false;
    return session.hasActionsThisTurn;
}
function broadcastState(session, kind = 'STATE_UPDATE') {
    for (const pid of [0, 1]) {
        const playerWs = session.connections[pid];
        if (playerWs) {
            send(playerWs, {
                type: kind,
                state: sanitizeStateFor(session.state, pid),
                canUndo: canUndoFor(session, pid),
            });
        }
    }
}
// ─── Public API ───────────────────────────────────────────────────────────────
const MAX_NAME_LENGTH = 50;
function sanitizeName(name) {
    if (typeof name !== 'string')
        return null;
    const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
    return trimmed.length > 0 ? trimmed : null;
}
/**
 * Creates a new session with player 0 already connected.
 * Returns the generated session ID.
 */
function createSession(playerName, ws) {
    const sanitized = sanitizeName(playerName);
    if (!sanitized) {
        send(ws, { type: 'ERROR', message: 'Invalid player name' });
        return null;
    }
    playerName = sanitized;
    const id = generateSessionId();
    const initial = (0, game_engine_1.createInitialState)(true);
    const session = {
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
function joinSession(sessionId, playerName, ws) {
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
    send(ws, {
        type: 'SESSION_JOINED',
        sessionId,
        playerId: 1,
        state: sanitizeStateFor(session.state, 1),
        canUndo: canUndoFor(session, 1),
    });
    // Tell player 0 the opponent arrived and the game is starting (their own reserved cards visible)
    const p0 = session.connections[0];
    if (p0) {
        send(p0, {
            type: 'GAME_STARTED',
            state: sanitizeStateFor(session.state, 0),
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
function dispatchAction(sessionId, playerId, action, ws) {
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
    const nextState = (0, game_engine_1.reducer)(session.state, action);
    if (nextState === session.state) {
        // Reducer returns the same reference for illegal moves
        send(ws, { type: 'ERROR', message: 'Invalid action' });
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
function undoTurn(sessionId, playerId, ws) {
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
function handleDisconnect(sessionId, playerId) {
    const session = sessions.get(sessionId);
    if (!session)
        return;
    session.connections[playerId] = null;
    const oppId = (1 - playerId);
    const oppWs = session.connections[oppId];
    if (oppWs) {
        send(oppWs, { type: 'OPPONENT_DISCONNECTED' });
    }
    // Remove sessions with no remaining connections, or waiting sessions where the host left
    const bothGone = !session.connections[0] && !session.connections[1];
    const hostLeft = session.status === 'waiting' && !session.connections[0];
    if (bothGone || hostLeft) {
        if (session.cleanupTimer !== null)
            clearTimeout(session.cleanupTimer);
        sessions.delete(sessionId);
    }
}
/** Returns open (waiting/playing) sessions suitable for a lobby listing. */
function listSessions() {
    return Array.from(sessions.values())
        .filter(s => s.status !== 'finished')
        .map(s => ({
        sessionId: s.id,
        status: s.status,
        playerCount: (s.connections.filter(Boolean).length),
        hostName: s.playerNames[0],
    }));
}
//# sourceMappingURL=sessionManager.js.map