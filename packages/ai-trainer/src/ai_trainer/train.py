"""
CLI entry point for training the Splendor Duel RL agent.

Usage:
  train [OPTIONS]

Options:
  --iterations INT          Number of training iterations  [default: 500]
  --episodes-per-iter INT   Self-play episodes per iteration  [default: 20]
  --eval-every INT          Evaluate vs random every N iterations  [default: 50]
  --sim-url TEXT            game-sim server URL  [default: http://127.0.0.1:3002]
  --checkpoint-dir PATH     Directory for saving model checkpoints  [default: checkpoints]
  --lr FLOAT                Learning rate  [default: 3e-4]
"""

from __future__ import annotations

import os
from pathlib import Path

import torch
import torch.optim as optim
import typer

from .env import SplendorDuelEnv
from .model import ActorCriticNet
from .ppo import PPOConfig, update
from .self_play import collect_episodes
from .evaluate import win_rate_vs_random

app = typer.Typer(add_completion=False)


@app.command()
def main(
    iterations: int = typer.Option(500, help="Number of training iterations"),
    episodes_per_iter: int = typer.Option(20, help="Self-play episodes per iteration"),
    eval_every: int = typer.Option(50, help="Evaluate vs random every N iterations"),
    sim_url: str = typer.Option("http://127.0.0.1:3002", help="game-sim server URL"),
    checkpoint_dir: Path = typer.Option(Path("checkpoints"), help="Checkpoint directory"),
    lr: float = typer.Option(3e-4, help="Learning rate"),
) -> None:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    typer.echo(f"Training on {device}")

    env = SplendorDuelEnv(sim_url=sim_url)

    if not env.client.health():
        typer.echo(
            f"ERROR: game-sim server not reachable at {sim_url}\n"
            "Start it with: cd packages/game-sim && npm run dev",
            err=True,
        )
        raise typer.Exit(code=1)

    model = ActorCriticNet().to(device)
    optimizer = optim.Adam(model.parameters(), lr=lr)
    config = PPOConfig()

    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    for iteration in range(1, iterations + 1):
        episodes = collect_episodes(model, env, episodes_per_iter, device=device)
        losses = update(model, optimizer, episodes, config=config, device=device)

        n_transitions = sum(len(ep) for ep in episodes)
        typer.echo(
            f"[{iteration:4d}/{iterations}] "
            f"transitions={n_transitions:5d}  "
            f"policy_loss={losses['policy_loss']:.4f}  "
            f"value_loss={losses['value_loss']:.4f}  "
            f"entropy={losses['entropy']:.4f}"
        )

        if iteration % eval_every == 0:
            win_rate = win_rate_vs_random(model, env, n_games=100, device=device)
            typer.echo(f"  >> Win rate vs random: {win_rate:.1%}")

            ckpt_path = checkpoint_dir / f"model_iter{iteration:04d}_wr{win_rate:.2f}.pt"
            torch.save({"iteration": iteration, "model_state": model.state_dict()}, ckpt_path)
            typer.echo(f"  >> Checkpoint saved: {ckpt_path}")

    env.close()
    typer.echo("Training complete.")
