import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action, PlayerId } from '@splendor-duel/game-engine';
import type { ClientGameState, ClientMessage, ServerMessage } from '@splendor-duel/protocol';

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'awaiting_session'   // connected but no session yet
  | 'waiting_for_opponent'
  | 'in_game'
  | 'game_over'
  | 'opponent_disconnected'
  | 'error';

export interface SessionInfo {
  status: ConnectionStatus;
  sessionId: string | null;
  playerId: PlayerId | null;
  playerName: string;
  opponentName: string | null;
  state: ClientGameState | null;
  canUndo: boolean;
  errorMessage: string | null;
}

const INITIAL: SessionInfo = {
  status: 'disconnected',
  sessionId: null,
  playerId: null,
  playerName: '',
  opponentName: null,
  state: null,
  canUndo: false,
  errorMessage: null,
};

export interface GameSession {
  info: SessionInfo;
  /** Reclaim this tab's stored seat; false when there is nothing stored. */
  resume: () => boolean;
  /** Connect and create a session as soon as the socket is open. */
  connectAndCreate: (url: string, playerName: string) => void;
  /** Connect and join an existing session as soon as the socket is open. */
  connectAndJoin: (url: string, playerName: string, sessionId: string) => void;
  dispatch: (action: Action) => void;
  undo: () => void;
  reset: () => void;
}

type PendingIntent =
  | { kind: 'create' }
  | { kind: 'join'; sessionId: string }
  | { kind: 'reconnect'; sessionId: string; reconnectToken: string }
  | null;

/**
 * Where a seat's reconnect credentials live across a reload.
 *
 * sessionStorage rather than localStorage: the credential is scoped to one tab,
 * which is what a seat is. In localStorage a second tab would pick up the same
 * token and the two would fight over the seat.
 */
const RESUME_KEY = 'splendor-duel:resume';

interface ResumeRecord {
  url: string;
  sessionId: string;
  reconnectToken: string;
  playerName: string;
}

function readResume(): ResumeRecord | null {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ResumeRecord>;
    if (!parsed.url || !parsed.sessionId || !parsed.reconnectToken) return null;
    return {
      url: parsed.url,
      sessionId: parsed.sessionId,
      reconnectToken: parsed.reconnectToken,
      playerName: parsed.playerName ?? '',
    };
  } catch {
    // Private browsing and blocked storage both throw here. Losing the ability
    // to resume is not worth failing the whole connection over.
    return null;
  }
}

function writeResume(record: ResumeRecord): void {
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify(record));
  } catch { /* storage unavailable; resume is a convenience, not a requirement */ }
}

function clearResume(): void {
  try {
    sessionStorage.removeItem(RESUME_KEY);
  } catch { /* as above */ }
}

export function useGameSession(): GameSession {
  const [info, setInfo] = useState<SessionInfo>(INITIAL);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingIntentRef = useRef<PendingIntent>(null);
  // handleMessage is captured by closure inside the WS event listener; keep it
  // in a ref so any future additions that read state-from-closure stay correct.
  const handleMessageRef = useRef<(msg: ServerMessage) => void>(() => {});

  const handleMessage = useCallback((msg: ServerMessage) => {
    setInfo(prev => {
      switch (msg.type) {
        case 'SESSION_CREATED':
          return {
            ...prev,
            status: 'waiting_for_opponent',
            sessionId: msg.sessionId,
            playerId: msg.playerId,
            errorMessage: null,
          };
        case 'SESSION_RESUMED':
          return {
            ...prev,
            status: msg.state.phase === 'game_over' ? 'game_over' : 'in_game',
            sessionId: msg.sessionId,
            playerId: msg.playerId,
            state: msg.state,
            canUndo: msg.canUndo,
            opponentName: msg.opponentName,
            errorMessage: msg.opponentConnected ? null : 'Opponent is disconnected.',
          };
        case 'OPPONENT_RECONNECTED':
          return { ...prev, status: 'in_game', errorMessage: null };
        case 'SESSION_JOINED':
          return {
            ...prev,
            status: 'in_game',
            sessionId: msg.sessionId,
            playerId: msg.playerId,
            state: msg.state,
            canUndo: msg.canUndo,
            errorMessage: null,
          };
        case 'GAME_STARTED':
          return {
            ...prev,
            status: 'in_game',
            state: msg.state,
            canUndo: msg.canUndo,
            opponentName: msg.opponentName,
            errorMessage: null,
          };
        case 'STATE_UPDATE': {
          const newStatus: ConnectionStatus = msg.state.phase === 'game_over' ? 'game_over' : 'in_game';
          return {
            ...prev,
            status: newStatus,
            state: msg.state,
            canUndo: msg.canUndo,
            errorMessage: null,
          };
        }
        case 'OPPONENT_DISCONNECTED':
          return { ...prev, status: 'opponent_disconnected' };
        case 'ERROR':
          return { ...prev, errorMessage: msg.message };
        case 'PONG':
          return prev;
        default:
          return prev;
      }
    });
  }, []);

  // Keep the ref pointing at the latest handler.
  useEffect(() => {
    handleMessageRef.current = handleMessage;
  }, [handleMessage]);

  const sendRaw = useCallback((ws: WebSocket, msg: ClientMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback((url: string, playerName: string, intent: PendingIntent) => {
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* noop */ }
    }
    pendingIntentRef.current = intent;
    setInfo({ ...INITIAL, status: 'connecting', playerName });
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      setInfo(prev => ({ ...prev, status: 'awaiting_session' }));
      const pending = pendingIntentRef.current;
      pendingIntentRef.current = null;
      if (pending?.kind === 'create') {
        sendRaw(ws, { type: 'CREATE_SESSION', playerName });
      } else if (pending?.kind === 'join') {
        sendRaw(ws, { type: 'JOIN_SESSION', sessionId: pending.sessionId, playerName });
      } else if (pending?.kind === 'reconnect') {
        sendRaw(ws, {
          type: 'RECONNECT_SESSION',
          sessionId: pending.sessionId,
          reconnectToken: pending.reconnectToken,
        });
      }
    });

    ws.addEventListener('error', () => {
      setInfo(prev => ({ ...prev, status: 'error', errorMessage: 'Connection failed' }));
    });

    ws.addEventListener('close', () => {
      wsRef.current = null;
      setInfo(prev => prev.status === 'in_game' || prev.status === 'waiting_for_opponent'
        ? { ...prev, status: 'opponent_disconnected' }
        : prev.status === 'game_over' ? prev : { ...prev, status: 'disconnected' });
    });

    ws.addEventListener('message', (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as ServerMessage;
      } catch {
        return;
      }

      // Persisting the seat credential is a side effect, so it happens here
      // rather than inside the state updater, which React may run twice.
      if (msg.type === 'SESSION_CREATED' || msg.type === 'SESSION_JOINED') {
        writeResume({
          url,
          sessionId: msg.sessionId,
          reconnectToken: msg.reconnectToken,
          playerName,
        });
      }
      // A finished game cannot be rejoined, so stop advertising a seat in it.
      if (msg.type === 'STATE_UPDATE' && msg.state.phase === 'game_over') {
        clearResume();
      }
      // The token we presented was refused (expired session, or the grace
      // period lapsed); drop it so we do not retry on the next reload.
      if (msg.type === 'ERROR' && /reconnect token|Session not found/i.test(msg.message)) {
        clearResume();
      }

      handleMessageRef.current(msg);
    });
  }, [sendRaw]);

  const connectAndCreate = useCallback((url: string, playerName: string) => {
    connect(url, playerName, { kind: 'create' });
  }, [connect]);

  const connectAndJoin = useCallback((url: string, playerName: string, sessionId: string) => {
    connect(url, playerName, { kind: 'join', sessionId });
  }, [connect]);

  /**
   * Reclaims the seat stored for this tab, if there is one.
   *
   * Returns false when there is nothing to resume, so the caller can fall
   * through to showing the lobby.
   */
  const resume = useCallback((): boolean => {
    const record = readResume();
    if (!record) return false;
    connect(record.url, record.playerName, {
      kind: 'reconnect',
      sessionId: record.sessionId,
      reconnectToken: record.reconnectToken,
    });
    return true;
  }, [connect]);

  const dispatch = useCallback((action: Action) => {
    const ws = wsRef.current;
    if (ws) sendRaw(ws, { type: 'DISPATCH_ACTION', action });
    // Optimistically clear any prior error — the user is acting again, so the
    // stale error is no longer meaningful. The server's response will replace
    // it (with a new ERROR or with a STATE_UPDATE that already clears it).
    setInfo(prev => prev.errorMessage ? { ...prev, errorMessage: null } : prev);
  }, [sendRaw]);

  const undo = useCallback(() => {
    const ws = wsRef.current;
    if (ws) sendRaw(ws, { type: 'UNDO_TURN' });
  }, [sendRaw]);

  const reset = useCallback(() => {
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* noop */ }
    }
    wsRef.current = null;
    pendingIntentRef.current = null;
    // Leaving deliberately: do not resume back into the game on the next load.
    clearResume();
    setInfo(INITIAL);
  }, []);

  /**
   * Resume once on mount, so a reload lands back at the table instead of the
   * lobby. Guarded by a ref because StrictMode mounts effects twice in
   * development and two sockets would race for the seat.
   */
  const resumeAttempted = useRef(false);
  useEffect(() => {
    if (resumeAttempted.current) return;
    resumeAttempted.current = true;
    resume();
  }, [resume]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* noop */ }
      }
    };
  }, []);

  return { info, resume, connectAndCreate, connectAndJoin, dispatch, undo, reset };
}
