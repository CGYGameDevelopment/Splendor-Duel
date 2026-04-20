"""
CLI entry point for training the Splendor Duel RL agent.

Usage:
  train [OPTIONS]

Options:
  --iterations INT          Number of training iterations  [default: 500]
  --episodes-per-iter INT   Self-play episodes per iteration  [default: 20]
  --eval-every INT          Evaluate vs random every N iterations  [default: 50]
  --checkpoint-every INT    Save latest checkpoint every N iterations  [default: 10]
  --sim-url TEXT            game-sim server URL  [default: http://127.0.0.1:3002]
  --checkpoint-dir PATH     Directory for saving model checkpoints  [default: packages/ai-trainer/checkpoints]
  --lr FLOAT                Learning rate  [default: 3e-4]
  --resume PATH             Resume training from a checkpoint file
"""

from __future__ import annotations

import copy
import csv
from pathlib import Path

import requests
import torch
import torch.optim as optim
import typer

from .env import SplendorDuelEnv
from .model import ActorCriticNet
from .ppo import PPOConfig, update
from .self_play import collect_episodes
from .evaluate import win_rate_vs_greedy, win_rate_vs_model

app = typer.Typer(add_completion=False)


CHECKPOINT_VERSION = 1


def _save_checkpoint(
    path: Path,
    iteration: int,
    model: ActorCriticNet,
    optimizer: optim.Optimizer,
    win_rate: float | None = None,
) -> None:
    payload: dict = {
        "version": CHECKPOINT_VERSION,
        "iteration": iteration,
        "model_state": model.state_dict(),
        "optimizer_state": optimizer.state_dict(),
    }
    if win_rate is not None:
        payload["win_rate"] = win_rate
    torch.save(payload, path)


@app.command()
def main(
    iterations: int = typer.Option(500, help="Number of training iterations"),
    episodes_per_iter: int = typer.Option(20, help="Self-play episodes per iteration"),
    eval_every: int = typer.Option(50, help="Evaluate vs random every N iterations"),
    checkpoint_every: int = typer.Option(5, help="Save latest checkpoint every N iterations"),
    sim_url: str = typer.Option("http://127.0.0.1:3002", help="game-sim server URL"),
    checkpoint_dir: Path = typer.Option(Path(__file__).resolve().parent.parent.parent / "checkpoints", help="Checkpoint directory"),
    lr: float = typer.Option(3e-4, help="Learning rate"),
    resume: Path | None = typer.Option(None, help="Resume from checkpoint file"),
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

    start_iteration = 1
    if resume is not None:
        if not resume.exists():
            typer.echo(f"ERROR: checkpoint not found: {resume}", err=True)
            raise typer.Exit(code=1)
        ckpt = torch.load(resume, map_location=device, weights_only=True)
        ckpt_version = ckpt.get("version", 0)
        if ckpt_version != CHECKPOINT_VERSION:
            typer.echo(
                f"WARNING: checkpoint version mismatch (file={ckpt_version}, "
                f"expected={CHECKPOINT_VERSION}). Weights loaded but optimizer state skipped.",
                err=True,
            )
            model.load_state_dict(ckpt["model_state"])
        else:
            model.load_state_dict(ckpt["model_state"])
            optimizer.load_state_dict(ckpt["optimizer_state"])
        start_iteration = ckpt["iteration"] + 1
        typer.echo(f"Resumed from {resume} (iteration {ckpt['iteration']})")

    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    # Snapshot of the model at the previous evaluation point, used for
    # checkpoint-vs-checkpoint comparison during evaluation.
    prev_model: ActorCriticNet | None = None

    # Track the best win rate seen across the entire run so we can persist the
    # best-performing weights separately from the rolling latest/milestone saves.
    best_win_rate: float = -1.0
    best_ckpt_path = checkpoint_dir / "best.pt"
    if best_ckpt_path.exists():
        try:
            saved = torch.load(best_ckpt_path, map_location="cpu", weights_only=True)
            best_win_rate = float(saved.get("win_rate", -1.0))
            typer.echo(f"Existing best win rate: {best_win_rate:.1%}")
        except Exception:
            pass

    log_path = checkpoint_dir / "training_log.csv"
    log_existed = log_path.exists()

    try:
        with open(log_path, "a", newline="") as log_file:
            writer = csv.writer(log_file)
            if not log_existed:
                writer.writerow(["iteration", "transitions", "policy_loss", "value_loss", "entropy", "win_rate"])

            for iteration in range(start_iteration, start_iteration + iterations):
                try:
                    episodes = collect_episodes(model, env, episodes_per_iter, device=device)
                except requests.RequestException as exc:
                    typer.echo(
                        f"\nERROR: game-sim server became unreachable at iteration {iteration}: {exc}\n"
                        "Save the latest checkpoint and restart the server, then resume with --resume.",
                        err=True,
                    )
                    _save_checkpoint(checkpoint_dir / "latest.pt", iteration - 1, model, optimizer)
                    raise typer.Exit(code=1)

                losses = update(model, optimizer, episodes, config=config, device=device)

                n_transitions = sum(len(ep) for ep in episodes)
                n_episodes = len(episodes)
                p0_wins = sum(
                    1 for ep in episodes
                    if ep.transitions and (
                        (ep.transitions[-1].reward > 0 and ep.transitions[-1].player_id == 0)
                        or (ep.transitions[-1].reward < 0 and ep.transitions[-1].player_id == 1)
                    )
                )
                avg_moves = n_transitions / n_episodes if n_episodes else 0
                typer.echo(
                    f"[{iteration:4d}] "
                    f"transitions={n_transitions:5d}  "
                    f"won={p0_wins}/{n_episodes}  "
                    f"moves={avg_moves:.0f}  "
                    f"policy_loss={losses['policy_loss']:.4f}  "
                    f"value_loss={losses['value_loss']:.4f}  "
                    f"entropy={losses['entropy']:.4f}"
                )

                win_rate: float | None = None

                if iteration % eval_every == 0:
                    try:
                        win_rate = win_rate_vs_greedy(model, env, n_games=100, device=device)
                        typer.echo(f"  >> Win rate vs greedy: {win_rate:.1%}")

                        if prev_model is not None:
                            wr_vs_prev = win_rate_vs_model(model, prev_model, env, n_games=50, device=device)
                            typer.echo(f"  >> Win rate vs prev checkpoint: {wr_vs_prev:.1%}")
                    except requests.RequestException as exc:
                        typer.echo(f"  >> Evaluation skipped (server error): {exc}", err=True)

                    wr_str = f"{win_rate:.2f}" if win_rate is not None else "na"
                    ckpt_path = checkpoint_dir / f"model_iter{iteration:04d}_wr{wr_str}.pt"
                    _save_checkpoint(ckpt_path, iteration, model, optimizer, win_rate)
                    typer.echo(f"  >> Checkpoint saved: {ckpt_path}")

                    if win_rate is not None and win_rate > best_win_rate:
                        best_win_rate = win_rate
                        _save_checkpoint(checkpoint_dir / "best.pt", iteration, model, optimizer, win_rate)
                        typer.echo(f"  >> New best model (win rate: {win_rate:.1%})")

                    # Snapshot current model for next checkpoint comparison
                    prev_model = ActorCriticNet().to(device)
                    prev_model.load_state_dict(copy.deepcopy(model.state_dict()))
                    prev_model.eval()

                elif iteration % checkpoint_every == 0:
                    _save_checkpoint(checkpoint_dir / "latest.pt", iteration, model, optimizer)

                writer.writerow([
                    iteration,
                    n_transitions,
                    f"{losses['policy_loss']:.6f}",
                    f"{losses['value_loss']:.6f}",
                    f"{losses['entropy']:.6f}",
                    f"{win_rate:.4f}" if win_rate is not None else "",
                ])
                log_file.flush()
    finally:
        env.close()

    typer.echo("Training complete.")
