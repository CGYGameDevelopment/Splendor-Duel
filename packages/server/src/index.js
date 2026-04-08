"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = __importDefault(require("http"));
const ws_1 = require("ws");
const sessionManager_1 = require("./sessionManager");
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
// ─── HTTP ─────────────────────────────────────────────────────────────────────
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
/** List open sessions (lobby). */
app.get('/sessions', (_req, res) => {
    res.json((0, sessionManager_1.listSessions)());
});
/** Health check. */
app.get('/health', (_req, res) => {
    res.json({ ok: true });
});
// ─── WebSocket ────────────────────────────────────────────────────────────────
const server = http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ server });
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_MESSAGES = 20;
wss.on('connection', (ws) => {
    let sessionId = null;
    let playerId = null;
    // Per-connection rate limiting
    let messageTimestamps = [];
    ws.on('message', (data) => {
        const now = Date.now();
        messageTimestamps = messageTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
        if (messageTimestamps.length >= RATE_LIMIT_MAX_MESSAGES) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Rate limit exceeded' }));
            return;
        }
        messageTimestamps.push(now);
        let msg;
        try {
            msg = JSON.parse(data.toString());
        }
        catch {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Malformed JSON' }));
            return;
        }
        switch (msg.type) {
            case 'CREATE_SESSION': {
                const newSessionId = (0, sessionManager_1.createSession)(msg.playerName, ws);
                if (newSessionId !== null) {
                    sessionId = newSessionId;
                    playerId = 0;
                }
                break;
            }
            case 'JOIN_SESSION': {
                const pid = (0, sessionManager_1.joinSession)(msg.sessionId, msg.playerName, ws);
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
                (0, sessionManager_1.dispatchAction)(sessionId, playerId, msg.action, ws);
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
            (0, sessionManager_1.handleDisconnect)(sessionId, playerId);
        }
    });
    ws.on('error', (err) => {
        console.error(`WebSocket error (session=${sessionId ?? 'none'}, player=${playerId ?? 'none'}): ${err.message}`);
    });
});
// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`Splendor Duel server listening on http://localhost:${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});
//# sourceMappingURL=index.js.map