# How to Train the Splendor Duel AI

This guide walks you through setting up and running the reinforcement learning pipeline that trains an AI to play Splendor Duel.

---

## Overview

The training pipeline has two parts that work together:

```
packages/game-sim      — TypeScript HTTP server (exposes the game engine to Python)
packages/ai-trainer    — Python package (trains a neural network via self-play)
```

The AI learns by playing games against itself. After each batch of games, it updates its neural network using **PPO** (Proximal Policy Optimization) — a reinforcement learning algorithm that gradually improves the AI's decisions based on whether it won or lost.

---

## Prerequisites

- **Node.js** 18+ and **npm** (for the game sim server)
- **Python** 3.11+ (for training)
- A Python virtual environment (recommended)

---

## Step 1 — Build the game sim server

The game sim server wraps the TypeScript game engine so Python can call it over HTTP.

```bash
# From the repo root
npm install
cd packages/game-sim
npm run build
```

You only need to rebuild if you change the game engine.

---

## Step 2 — Set up the Python environment

```bash
# Create and activate a virtual environment (do this once)
python -m venv .venv

# Windows
.venv\Scripts\activate


# Install the AI trainer package
cd packages/ai-trainer
pip install -e ".[dev]"
```

Install PyTorch separately if needed. Visit https://pytorch.org/get-started/locally/ and select your platform to get the right install command. For CPU-only training:

```bash
pip install torch
```

---

## Step 3 — Start the game sim server

Open a terminal and leave it running throughout training:

```bash
cd packages/game-sim
npm run dev
```

You should see:

```
game-sim listening on http://127.0.0.1:3002
```

To verify it is working:

```bash
curl -X GET http://127.0.0.1:3002/health
# → {"ok":true,"sessions":0}
```

---

## Step 4 — Run training

In a second terminal (with your Python venv activated):

```bash
train
```

This runs with sensible defaults: 500 iterations, 20 self-play games per iteration, evaluated against a random agent every 50 iterations.

**Custom options:**

```bash
train --iterations 1000 --episodes-per-iter 40 --eval-every 25
```

| Option | Default | Description |
|---|---|---|
| `--iterations` | 500 | Total number of training iterations |
| `--episodes-per-iter` | 20 | Self-play games collected before each update |
| `--eval-every` | 50 | How often to measure win rate vs random agent |
| `--checkpoint-every` | 10 | How often to save a rolling `latest.pt` checkpoint |
| `--sim-url` | `http://127.0.0.1:3002` | URL of the game sim server |
| `--checkpoint-dir` | `checkpoints` | Where to save model snapshots |
| `--lr` | `0.0003` | Learning rate |
| `--resume` | *(none)* | Path to a checkpoint file to resume training from |

---

## What training output looks like

```
Training on cpu
[   1/500] transitions=  847  policy_loss=0.0312  value_loss=0.4821  entropy=6.1203
[   2/500] transitions=  912  policy_loss=0.0289  value_loss=0.4650  entropy=6.0987
...
[  50/500] transitions=  876  policy_loss=0.0201  value_loss=0.3102  entropy=5.8841
  >> Win rate vs random: 54.0%
  >> Win rate vs prev checkpoint: 58.0%
  >> Checkpoint saved: checkpoints/model_iter0050_wr0.54.pt
```

**What to watch:**
- **Win rate vs random** should climb above 50% after ~100 iterations and continue improving
- **Win rate vs prev checkpoint** shows improvement since the last evaluation — should stay above 50% as training progresses
- **Entropy** should decrease slowly over time (the AI becomes less random)
- **Value loss** should decrease as the network learns to predict outcomes

---

## Checkpoints

Three types of checkpoint are saved to `checkpoints/`:

| File | When saved | Purpose |
|---|---|---|
| `model_iter####_wr#.##.pt` | Every `--eval-every` iterations | Milestone snapshot with iteration and win rate in the name |
| `latest.pt` | Every `--checkpoint-every` iterations (default 10) | Rolling save for crash recovery |
| `best.pt` | When a new highest win rate is reached | Best model weights across the entire run |

Example milestone filenames:

```
checkpoints/model_iter0050_wr0.54.pt
checkpoints/model_iter0100_wr0.61.pt
```

To resume or load a checkpoint in Python:

```python
import torch
from ai_trainer.model import ActorCriticNet

model = ActorCriticNet()
ckpt = torch.load("checkpoints/model_iter0100_wr0.61.pt")
model.load_state_dict(ckpt["model_state"])
model.eval()
```

---

## How the AI works

### State encoding
Each game state is converted into a 858-element float vector capturing the board tokens, card pyramid, both players' tokens/cards/prestige, privileges, and current phase. The network always sees the state from the current player's perspective.

### Action space
There are 3677 possible action slots covering all move types (take tokens, purchase cards, reserve cards, use privileges, discard tokens, take individual tokens from the board or opponent, replenish the board, end optional phases, and place bonus cards). At each step, the network outputs a score for all 3677 slots, illegal moves are masked to negative infinity, and the AI samples from the remaining distribution.

### Self-play
Both sides of each training game use the same model. The AI effectively plays against itself, improving by learning from its own wins and losses.

### PPO update
After each batch of games, the policy and value networks are updated via PPO — a stable RL algorithm that clips gradient updates to prevent the model from changing too drastically in one step.

---

## Architecture

```
packages/
  game-engine/    Core game logic (TypeScript) — source of truth, never modified here
  game-sim/       HTTP server wrapping game-engine (TypeScript)
  ai-trainer/
    src/ai_trainer/
      sim_client.py      HTTP client for the game-sim server
      action_space.py    3677-action vocabulary + legal move masking
      state_encoder.py   GameState → float[858] tensor
      env.py             gymnasium.Env for the game
      model.py           ActorCriticNet (policy + value heads)
      random_agent.py    Uniform-random baseline agent
      self_play.py       Collects game episodes using the current model
      ppo.py             PPO update loop
      evaluate.py        Win-rate measurement vs random agent and vs previous checkpoint
      bot_client.py      WebSocket bot for play-vs-ai
      train.py           CLI entry point (`train`)
```

---

## Troubleshooting

**`ERROR: game-sim server not reachable`**
The game sim server is not running. Open a separate terminal and run `npm run dev` inside `packages/game-sim`.

**`No legal actions available`**
This should not happen during normal play. If it does, rebuild the game-sim server (`npm run build`) to ensure it is in sync with the latest game engine.

**Training is slow**
Each iteration requires playing full games over HTTP. For faster training, increase `--episodes-per-iter` to get more data per update, or run on a machine with a GPU (PyTorch will use it automatically if available).

**Win rate is not improving after many iterations**
Try reducing the learning rate (`--lr 1e-4`) or increasing episodes per iteration (`--episodes-per-iter 50`) to give the model more signal per update.

