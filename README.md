# Splendor Duel

A TypeScript monorepo implementation of the **Splendor Duel** board game, with a Python reinforcement learning training pipeline.

See `CLAUDE.md` for architecture principles, coding conventions, and game rules guidance.  
See `rulebook.md` for the authoritative game rules.

---

## Prerequisites

- **Node.js** v20+
- **npm** v10+
- **Python** 3.11+ (AI trainer only)

---

## Install & Build

```bash
npm install
npm run build       # builds all packages
npm run test        # runs all tests
```

---

## Play Locally (2-player CLI)

Builds the engine, starts the server, and opens two CLI client windows:

```bash
start_the_game.bat
```

Or manually:

```bash
npm run build --workspace=packages/game-engine
npm run dev --workspace=packages/server        # port 3001
npm run dev --workspace=packages/cli-client    # repeat for player 2
```

---

## AI Training

Requires the game sim server running alongside the Python trainer.

**1. Start the AI game sim server:**
```bash
npm run dev --workspace=packages/ai-game-sim   # HTTP server for Python env
```

**2. Install the Python package (once):**
```bash
cd packages/ai-trainer
pip install -e .
```

**3. Run training:**
```bash
train
```

**4. Play against the trained bot:**
```bash
.venv\Scripts\play-vs-ai.exe checkpoints\best.pt
```

Or use the convenience launcher (starts all servers + CLI in separate windows):
```bash
play_vs_ai.bat
```

---

## Packages

| Package | Description |
|---|---|
| `packages/game-engine` | Core game logic — types, reducer, legal moves, helpers |
| `packages/server` | Express + WebSocket multiplayer server |
| `packages/cli-client` | Terminal client for local play |
| `packages/ai-game-sim` | HTTP server wrapping game-engine for Python AI training |
| `packages/ai-trainer` | Python PPO reinforcement learning pipeline |
| `packages/client` | React + Vite frontend (not actively developed) |
