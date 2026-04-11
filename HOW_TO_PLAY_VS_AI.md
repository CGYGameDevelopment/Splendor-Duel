# How to Play vs the AI

You need **three terminals** and a trained checkpoint.

---

## Prerequisites

- Game-sim and WebSocket server built (`npm run build` from repo root)
- Python venv activated with `pip install -e ".[dev]"` run in `packages/ai-trainer`
- `websockets` installed — if not: `pip install websockets`
- A trained checkpoint in `checkpoints/`, e.g. `checkpoints/model_iter0500_wr0.80.pt`

---

## Step 1 — Start the game-sim server (Terminal 1)

```bash
cd packages/game-sim
npm run dev
```

Leave this running. The bot uses it to look up legal moves.

---

## Step 2 — Start the WebSocket server (Terminal 2)

```bash
cd packages/server
npm run dev
```

Leave this running. Both the bot and the CLI client connect here.

---

## Step 3 — Start the AI bot (Terminal 3)

```bash
play-vs-ai checkpoints/model_iter0500_wr0.80.pt
```

The bot will print a session ID:

```
Loaded: checkpoints/model_iter0500_wr0.80.pt
Connecting to ws://localhost:3001 ...

Session ID: a3f7c2d1-...
Share that ID with the human player, then have them join.

Waiting for opponent...
```

---

## Step 4 — Join as the human (Terminal 3 or a new one)

In another terminal (or the same machine):

```bash
cd packages/cli-client
npm run dev
```

When prompted:
1. Accept the default server URL (`ws://localhost:3001`)
2. Enter your name
3. Choose **join existing** (`j`)
4. Paste the session ID printed by the bot

The game starts immediately. You play as Player 1, the AI plays as Player 0 (so the AI goes first).

---

## Options

```bash
play-vs-ai --help
```

| Option | Default | Description |
|---|---|---|
| `checkpoint` | *(required)* | Path to the `.pt` checkpoint file |
| `--server` | `ws://localhost:3001` | WebSocket server URL |
| `--sim-url` | `http://127.0.0.1:3002` | game-sim server URL |
| `--name` | `AI` | Bot's display name shown in the CLI client |
| `--greedy` | off | Always pick the highest-probability move instead of sampling |

Use `--greedy` for the AI to play its strongest moves. Without it, the AI samples from its probability distribution, which adds variety but can occasionally make weaker choices.

---

## Troubleshooting

**`ERROR: game-sim server not reachable`**
Terminal 1 is not running. Start it with `npm run dev` in `packages/game-sim`.

**Bot makes no moves / game freezes**
The WebSocket server (Terminal 2) may not be running. Check Terminal 2 is active.

**`websockets` not found**
Run `pip install websockets` with your venv activated.

**Bot crashes on `load_state_dict`**
The checkpoint was saved from a different model architecture. Only use checkpoints from the current codebase — they are not portable across architecture changes.
