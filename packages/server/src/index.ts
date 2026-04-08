import express from 'express';
import cors from 'cors';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import type { PlayerId } from '@splendor-duel/game-engine';
import type { ClientMessage } from './protocol';
import {
  createSession,
  joinSession,
  dispatchAction,
  handleDisconnect,
  listSessions,
} from './sessionManager';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// ─── HTTP ─────────────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

/** List open sessions (lobby). */
app.get('/sessions', (_req, res) => {
  res.json(listSessions());
});

/** Health check. */
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// ─── WebSocket ────────────────────────────────────────────────────────────────

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_MESSAGES = 20;

wss.on('connection', (ws: WebSocket) => {
  let sessionId: string | null = null;
  let playerId: PlayerId | null = null;

  // Per-connection rate limiting
  let messageTimestamps: number[] = [];

  ws.on('message', (data) => {
    const now = Date.now();
    messageTimestamps = messageTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (messageTimestamps.length >= RATE_LIMIT_MAX_MESSAGES) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Rate limit exceeded' }));
      return;
    }
    messageTimestamps.push(now);

    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Malformed JSON' }));
      return;
    }

    switch (msg.type) {
      case 'CREATE_SESSION': {
        const newSessionId = createSession(msg.playerName, ws);
        if (newSessionId !== null) {
          sessionId = newSessionId;
          playerId = 0;
        }
        break;
      }
      case 'JOIN_SESSION': {
        const pid = joinSession(msg.sessionId, msg.playerName, ws);
        if (pid !== null) {
          sessionId = msg.sessionId;
          playerId = pid;
        }
        break;
      }
      case 'DISPATCH_ACTION': {
        if (sessionId === null || playerId === null) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Not in a session' }));
          return;
        }
        dispatchAction(sessionId, playerId, msg.action, ws);
        break;
      }
      case 'PING': {
        ws.send(JSON.stringify({ type: 'PONG' }));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (sessionId !== null && playerId !== null) {
      handleDisconnect(sessionId, playerId);
    }
  });

  ws.on('error', (err: Error) => {
    console.error(`WebSocket error (session=${sessionId ?? 'none'}, player=${playerId ?? 'none'}): ${err.message}`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`Splendor Duel server listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});
