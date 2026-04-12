# How to Train the Splendor Duel AI — ELI5 Edition

Imagine you want to teach a robot to play a board game. The robot starts out knowing **nothing** — it just clicks random buttons. But every time it plays, it gets a tiny bit smarter. Here's how that works.

---

## The Big Idea

We have two programs that team up:

- **The Game Sim** — like a board game table that never gets tired. It plays out games super fast.
- **The AI Trainer** — the robot's "brain coach". It watches the robot play, figures out what went wrong, and tweaks the brain to do better next time.

The robot plays games **against itself** (called *self-play*), wins or loses, and learns from the result. After enough rounds of this, it stops playing randomly and starts making smart moves.

---

## What You Need Before Starting

- **Node.js** — the game table runs on this
- **Python 3.12** — the brain coach runs on this (PyTorch doesn't support 3.13 or 3.14 yet)
- A virtual environment (just a tidy box to keep Python's stuff in)

---

## Step 1 — Build the Game Table

The game table is a small server that lets Python talk to the TypeScript game engine over the internet (locally on your computer).

```bash
npm install
cd packages/game-sim
npm run build
```

Think of this like assembling the board game before you can play. Only do it again if the game rules change.

---

## Step 2 — Set Up the Brain Coach's Toolbox

```cmd
py -3.12 -m venv .venv
.venv\Scripts\activate

cd packages\ai-trainer
pip install -e ".[dev]"
pip install torch               REM the math engine that powers the AI brain
```

This installs all the tools the brain coach needs to do its job.

---

## Step 3 — Turn the Game Table On

Open a terminal and leave it running the whole time:

```bash
cd packages/game-sim
npm run dev
```

You'll see:
```
game-sim listening on http://127.0.0.1:3002
```

The game table is now open for business. Don't close this window.

---

## Step 4 — Start Training

In a second terminal:

```bash
train
```

That's it. The robot will now play 500 rounds of self-improvement by default — playing 20 games, updating its brain, playing 20 more, and so on.

Want to run it longer or with more games per round?

```bash
train --iterations 1000 --episodes-per-iter 40
```

---

## What You'll See While It Trains

```
[   1/500] transitions=847  policy_loss=0.03  value_loss=0.48  entropy=6.12
[  50/500] transitions=876  policy_loss=0.02  value_loss=0.31  entropy=5.88
  >> Win rate vs random: 54.0%
  >> Checkpoint saved: checkpoints/model_iter0050_wr0.54.pt
```

In plain English:
- **Win rate** — how often the AI beats a robot that clicks randomly. Should climb past 50% after ~100 rounds and keep going up.
- **Entropy** — how "random" the AI's choices are. Should slowly go down as it gets more confident.
- **Value loss** — how wrong the AI is when it guesses who's going to win. Should go down over time.

---

## Checkpoints (Saving Your Progress)

Every time the AI is evaluated, it saves a snapshot of its brain:

```
checkpoints/model_iter0050_wr0.54.pt
checkpoints/model_iter0100_wr0.61.pt
```

The filename tells you *when* it was saved and *how well* it was doing. You can pick up from any of these later.

---

## How the AI Actually "Thinks"

1. **It looks at the board** — the whole game state gets squished into a list of 858 numbers the brain can read.
2. **It considers all 3677 possible moves** — things like "take these gems", "buy this card", "reserve that one", "discard these tokens", "take a token from the opponent".
3. **Illegal moves get blocked** — the brain can't accidentally cheat; bad moves are filtered out automatically.
4. **It picks a move** — based on which remaining moves it thinks are best.
5. **It wins or loses** — and the brain coach updates the brain based on what happened.

This loop repeats thousands of times until the AI is actually good.

---

## Something Not Working?

**Game table not found?**
You forgot to start Step 3. Open a terminal and run `npm run dev` in `packages/game-sim`.

**Training is really slow?**
That's normal on a regular laptop — every game has to be played out in full. Try `--episodes-per-iter 50` to squeeze more learning out of each update.

**Win rate stuck and not improving?**
Try a smaller learning rate: `train --lr 0.0001`. It's like telling the brain coach to take smaller, more careful steps.
