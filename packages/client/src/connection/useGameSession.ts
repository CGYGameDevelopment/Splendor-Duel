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
  | null;

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
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
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
    setInfo(INITIAL);
  }, []);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* noop */ }
      }
    };
  }, []);

  return { info, connectAndCreate, connectAndJoin, dispatch, undo, reset };
}
