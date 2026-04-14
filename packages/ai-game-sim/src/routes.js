"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const game_engine_1 = require("@splendor-duel/game-engine");
const store = __importStar(require("./simStore"));
const router = (0, express_1.Router)();
// POST /reset
// Body: { sessionId?: string, secondPlayerGetsPrivilege?: boolean }
// Returns: { sessionId, state, legalMoves }
router.post('/reset', (req, res) => {
    const sessionId = req.body.sessionId ?? (0, uuid_1.v4)();
    const secondPlayerGetsPrivilege = req.body.secondPlayerGetsPrivilege ?? true;
    const state = (0, game_engine_1.createInitialState)(secondPlayerGetsPrivilege);
    store.set(sessionId, state);
    const moves = (0, game_engine_1.legalMoves)(state);
    res.json({ sessionId, state, legalMoves: moves });
});
// POST /step
// Body: { sessionId, action }
// Returns: { state, legalMoves, done, winner }
router.post('/step', (req, res) => {
    const { sessionId, action } = req.body;
    if (!action) {
        res.status(400).json({ error: 'Missing action in request body' });
        return;
    }
    const state = store.get(sessionId);
    if (!state) {
        res.status(404).json({ error: `No session: ${sessionId}` });
        return;
    }
    const nextState = (0, game_engine_1.reducer)(state, action);
    store.set(sessionId, nextState);
    const moves = (0, game_engine_1.legalMoves)(nextState);
    const done = nextState.phase === 'game_over';
    res.json({
        state: nextState,
        legalMoves: moves,
        done,
        winner: nextState.winner,
    });
});
// POST /legal-moves
// Body: { sessionId }
// Returns: { legalMoves }
router.post('/legal-moves', (req, res) => {
    const { sessionId } = req.body;
    const state = store.get(sessionId);
    if (!state) {
        res.status(404).json({ error: `No session: ${sessionId}` });
        return;
    }
    res.json({ legalMoves: (0, game_engine_1.legalMoves)(state) });
});
// POST /legal-moves-from-state
// Body: { state: GameState }
// Returns: { legalMoves }
router.post('/legal-moves-from-state', (req, res) => {
    const { state } = req.body;
    if (!state) {
        res.status(400).json({ error: 'Missing state in request body' });
        return;
    }
    res.json({ legalMoves: (0, game_engine_1.legalMoves)(state) });
});
// DELETE /session/:id
router.delete('/session/:id', (req, res) => {
    store.remove(req.params.id);
    res.json({ ok: true });
});
// GET /health
router.get('/health', (_req, res) => {
    res.json({ ok: true, sessions: store.size() });
});
exports.default = router;
//# sourceMappingURL=routes.js.map