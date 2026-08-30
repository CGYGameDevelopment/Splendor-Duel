"""
PPO self-play training loop for Splendor Duel.

Run the game-sim server first:
    cd packages/ai-game-sim && npm run dev
"""

from __future__ import annotations

import csv
import time
from pathlib import Path

import numpy as np
import requests
import torch
import torch.optim as optim
import typer

from .env import VecSplendorDuelEnv
from .evaluate import win_rate_vs_greedy, win_rate_vs_model, win_rate_vs_random
from .model import ActorCriticNet, new_like
from .ppo import PPOConfig, update
from .self_play import OpponentPool, RolloutCollector

app = typer.Typer(add_completion=False)


# v7: pointer policy heads (board actions computed from the cells they name,
# card actions from card embeddings), residual trunk, dropout removed.  Every
# weight shape changed again, so v6 checkpoints cannot be loaded.
CHECKPOINT_VERSION = 7

# Transient network errors get retried with exponential backoff before the
# run surrenders.  HTTP errors from the server (4xx/5xx) are not retried --
# those indicate a real problem, not a blip.
_COLLECT_RETRY_ATTEMPTS = 4
_COLLECT_RETRY_BASE_DELAY = 1.0  # seconds

_LOG_COLUMNS = [
    "iteration", "transitions", "segments", "completed_games", "policy_loss",
    "value_loss", "entropy", "entropy_coef", "kl", "grad_norm", "trainable_frac",
    "pool_size", "win_rate_vs_greedy", "win_rate_vs_random",
]


def _collect_with_retries(
    collector: RolloutCollector,
    transitions_per_iter: int,
    opponent_prob: float,
):
    """Call the collector, retrying on transient connection/timeout errors."""
    last_exc: Exception | None = None
    for attempt in range(_COLLECT_RETRY_ATTEMPTS):
        try:
            return collector.collect(transitions_per_iter, opponent_prob=opponent_prob)
        except (requests.ConnectionError, requests.Timeout) as exc:
            last_exc = exc
            if attempt == _COLLECT_RETRY_ATTEMPTS - 1:
                break
            delay = _COLLECT_RETRY_BASE_DELAY * (2 ** attempt)
            typer.echo(
                f"  !! transient network error ({type(exc).__name__}); "
                f"retrying in {delay:.1f}s...",
                err=True,
            )
            time.sleep(delay)
    assert last_exc is not None
    raise last_exc


def _save_checkpoint(
    path: Path,
    iteration: int,
    model: ActorCriticNet,
    optimizer: optim.Optimizer,
    win_rate: float | None = None,
    opponent_pool: OpponentPool | None = None,
) -> None:
    payload: dict = {
        "version": CHECKPOINT_VERSION,
        "iteration": iteration,
        "arch": model.arch,
        "model_state": model.state_dict(),
        "optimizer_state": optimizer.state_dict(),
        "scheduled_lr": optimizer.param_groups[0]["lr"],
    }
    if win_rate is not None:
        payload["win_rate"] = win_rate
    if opponent_pool is not None and len(opponent_pool) > 0:
        # Persisted so a resumed run keeps its league instead of restarting
        # self-play against a single fresh opponent.
        payload["opponent_pool"] = opponent_pool.state_dicts()
    torch.save(payload, path)


def _anneal(start: float, end: float, frac_done: float) -> float:
    """Linear interpolation from `start` to `end` as frac_done goes 0 -> 1."""
    frac_done = min(max(frac_done, 0.0), 1.0)
    return start + (end - start) * frac_done


@app.command()
def main(
    iterations: int = typer.Option(500, help="Number of training iterations"),
    transitions_per_iter: int = typer.Option(
        16384,
        help="Transitions collected per iteration. Collection runs to this budget "
             "rather than an episode count, so every step batch stays full width.",
    ),
    eval_every: int = typer.Option(50, help="Evaluate vs baselines every N iterations"),
    eval_games: int = typer.Option(200, help="Games per baseline evaluation"),
    checkpoint_every: int = typer.Option(5, help="Save latest checkpoint every N iterations"),
    sim_url: str = typer.Option("http://127.0.0.1:3002", help="game-sim server URL"),
    checkpoint_dir: Path = typer.Option(Path(__file__).resolve().parent.parent.parent / "checkpoints", help="Checkpoint directory"),
    lr: float = typer.Option(3e-4, help="Learning rate"),
    lr_decay: bool = typer.Option(True, help="Linearly decay LR to 0 across the run"),
    entropy_coef: float = typer.Option(0.01, help="Initial entropy regularization coefficient"),
    entropy_coef_final: float = typer.Option(
        0.001, help="Entropy coefficient at the end of the run (linearly annealed)"
    ),
    parallel_envs: int = typer.Option(32, help="Games stepped in lockstep during rollouts"),
    trunk_depth: int = typer.Option(4, help="Residual blocks in the trunk"),
    trunk_width: int = typer.Option(512, help="Width of the residual trunk"),
    eval_envs: int = typer.Option(16, help="Games stepped in lockstep during evaluation"),
    opponent_prob: float = typer.Option(
        0.3, help="Fraction of rollout games played against a frozen pool checkpoint"
    ),
    opponent_pool_size: int = typer.Option(8, help="Past checkpoints retained in the pool"),
    pool_every: int = typer.Option(10, help="Add the current model to the pool every N iterations"),
    resume: Path | None = typer.Option(None, help="Resume from checkpoint file"),
    seed: int = typer.Option(42, help="Random seed for reproducibility"),
) -> None:
    torch.manual_seed(seed)
    np.random.seed(seed)
    rng = np.random.default_rng(seed)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    typer.echo(f"Training on {device} (seed={seed})")

    assert parallel_envs >= 1, "parallel_envs must be >= 1"
    assert eval_envs >= 1, "eval_envs must be >= 1"
    assert 0.0 <= opponent_prob <= 1.0, "opponent_prob must be a probability"

    env = VecSplendorDuelEnv(parallel_envs, sim_url=sim_url)
    eval_env = VecSplendorDuelEnv(eval_envs, sim_url=sim_url)

    if not env.client.health():
        typer.echo(
            f"ERROR: game-sim server not reachable at {sim_url}\n"
            "Start it with: cd packages/ai-game-sim && npm run dev",
            err=True,
        )
        raise typer.Exit(code=1)

    model = ActorCriticNet(trunk_depth=trunk_depth, trunk_width=trunk_width).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    typer.echo(f"Model parameters: {n_params:,}")
    optimizer = optim.Adam(model.parameters(), lr=lr)
    config = PPOConfig(entropy_coef=entropy_coef)
    opponent_pool = OpponentPool(max_size=opponent_pool_size)
    collector = RolloutCollector(
        model, env, device=device, opponent_pool=opponent_pool, rng=rng
    )

    start_iteration = 1
    start_lr = lr
    if resume is not None:
        if not resume.exists():
            typer.echo(f"ERROR: checkpoint not found: {resume}", err=True)
            raise typer.Exit(code=1)
        ckpt = torch.load(resume, map_location=device, weights_only=True)
        ckpt_version = ckpt.get("version", 0)
        weights_loaded = True

        # Rebuild at the checkpoint's shape when it differs from the CLI, so a
        # run started with --trunk-depth 6 resumes without needing the flag again.
        saved_arch = ckpt.get("arch")
        if saved_arch and saved_arch != model.arch:
            typer.echo(
                f"Checkpoint architecture {saved_arch} differs from the requested "
                f"{model.arch}; rebuilding to match the checkpoint.",
                err=True,
            )
            model = ActorCriticNet(**saved_arch).to(device)
            optimizer = optim.Adam(model.parameters(), lr=lr)
            collector.model = model
            n_params = sum(p.numel() for p in model.parameters())
            typer.echo(f"Model parameters: {n_params:,}")
        if ckpt_version != CHECKPOINT_VERSION:
            typer.echo(
                f"WARNING: checkpoint version mismatch (file={ckpt_version}, "
                f"expected={CHECKPOINT_VERSION}). Attempting to load weights; "
                f"optimizer state skipped.",
                err=True,
            )
            try:
                model.load_state_dict(ckpt["model_state"])
            except (RuntimeError, KeyError) as exc:
                weights_loaded = False
                typer.echo(
                    f"WARNING: could not load model weights (architecture mismatch?): {exc}\n"
                    "Starting with fresh weights.",
                    err=True,
                )
        else:
            model.load_state_dict(ckpt["model_state"])
            optimizer.load_state_dict(ckpt["optimizer_state"])

        if weights_loaded:
            start_iteration = ckpt["iteration"] + 1
            # Continue the LR schedule from where it left off rather than restarting
            # from the initial lr, which would cause a spike and destabilise training.
            start_lr = float(ckpt.get("scheduled_lr", lr))
            saved_pool = ckpt.get("opponent_pool")
            if saved_pool:
                opponent_pool.load(saved_pool)
                typer.echo(f"Restored opponent pool ({len(opponent_pool)} checkpoints)")
            typer.echo(f"Resumed from {resume} (iteration {ckpt['iteration']}, lr={start_lr:.2e})")
        else:
            # Nothing was carried over, so the iteration counter and the decayed LR
            # must not carry over either: a randomly-initialised model trained at the
            # tail of a previous run's LR schedule would barely learn.
            typer.echo(
                "Checkpoint contributed nothing -- starting a fresh run "
                f"(iteration 1, lr={lr:.2e}).",
                err=True,
            )

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
            if saved.get("version", 0) == CHECKPOINT_VERSION:
                best_win_rate = float(saved.get("win_rate", -1.0))
                typer.echo(f"Existing best win rate: {best_win_rate:.1%}")
            else:
                # A win rate produced by a different architecture / action space is
                # not a comparable bar; inheriting it would suppress best.pt saves.
                typer.echo(
                    "Ignoring best.pt from an incompatible checkpoint version -- "
                    "its win rate is not comparable to the current model.",
                    err=True,
                )
        except Exception:
            pass

    log_path = checkpoint_dir / "training_log.csv"
    log_existed = log_path.exists()

    try:
        with open(log_path, "a", newline="") as log_file:
            writer = csv.writer(log_file)
            if not log_existed:
                writer.writerow(_LOG_COLUMNS)

            total_iterations = iterations
            for iter_offset, iteration in enumerate(
                range(start_iteration, start_iteration + iterations)
            ):
                frac_done = iter_offset / max(total_iterations, 1)

                if lr_decay:
                    scheduled_lr = max(start_lr * (1.0 - frac_done), lr * 0.05)
                    for pg in optimizer.param_groups:
                        pg["lr"] = scheduled_lr

                # Anneal exploration down over the run.  A constant high
                # coefficient pins the policy near-uniform: the entropy term
                # then dominates the loss and the agent never commits to a plan.
                config.entropy_coef = _anneal(entropy_coef, entropy_coef_final, frac_done)

                active_opponent_prob = opponent_prob if len(opponent_pool) > 0 else 0.0

                try:
                    episodes = _collect_with_retries(
                        collector, transitions_per_iter, active_opponent_prob
                    )
                except requests.RequestException as exc:
                    typer.echo(
                        f"\nERROR: game-sim server became unreachable at iteration {iteration}: {exc}\n"
                        "Save the latest checkpoint and restart the server, then resume with --resume.",
                        err=True,
                    )
                    _save_checkpoint(
                        checkpoint_dir / "latest.pt", iteration - 1, model, optimizer,
                        opponent_pool=opponent_pool,
                    )
                    raise typer.Exit(code=1)

                losses = update(model, optimizer, episodes, config=config, device=device)

                n_transitions = sum(len(ep) for ep in episodes)
                n_segments = len(episodes)
                # Segments that stop mid-game are expected now that collection
                # runs to a transition budget, so the meaningful counts are how
                # many games finished and what ended them.
                completed_games = 0
                pool_games = 0
                pool_wins = 0
                win_condition_counts: dict[str, int] = {}
                for ep in episodes:
                    if not ep.transitions or not ep.transitions[-1].done:
                        continue
                    completed_games += 1
                    if ep.win_condition:
                        win_condition_counts[ep.win_condition] = (
                            win_condition_counts.get(ep.win_condition, 0) + 1
                        )
                    if ep.learner_won is not None:
                        pool_games += 1
                        pool_wins += int(ep.learner_won)

                avg_segment = n_transitions / n_segments if n_segments else 0
                current_lr = optimizer.param_groups[0]["lr"]
                wc_str = "  ".join(
                    f"{k}={v}" for k, v in sorted(win_condition_counts.items())
                ) or "none"
                kl_val = losses.get("kl", 0.0)
                pool_str = (
                    f"  vs_pool={pool_wins}/{pool_games}" if pool_games else ""
                )
                typer.echo(
                    f"[{iteration:4d}] "
                    f"lr={current_lr:.2e}  "
                    f"ent_c={config.entropy_coef:.4f}  "
                    f"transitions={n_transitions:5d}  "
                    f"games={completed_games:3d}/{n_segments:3d}seg  "
                    f"seg_len={avg_segment:.0f}  "
                    f"win_by=[{wc_str}]{pool_str}  "
                    f"policy_loss={losses['policy_loss']:.4f}  "
                    f"value_loss={losses['value_loss']:.4f}  "
                    f"entropy={losses['entropy']:.4f}  "
                    f"kl={kl_val:.4f}  "
                    f"grad_norm={losses.get('grad_norm', 0.0):.3f}"
                )
                if kl_val > 0.05:
                    typer.echo(
                        f"  !! high KL divergence ({kl_val:.4f} > 0.05) -- "
                        "policy is changing rapidly; consider reducing lr or clip_eps",
                        err=True,
                    )

                # Grow the league.  Snapshots are taken on a fixed cadence so the
                # pool spans the run's history rather than clustering at the end.
                if pool_every > 0 and iteration % pool_every == 0:
                    opponent_pool.add(model)

                win_rate: float | None = None
                win_rate_random: float | None = None

                if iteration % eval_every == 0:
                    try:
                        win_rate = win_rate_vs_greedy(
                            model, eval_env, n_games=eval_games, device=device
                        )
                        typer.echo(f"  >> Win rate vs greedy:  {win_rate:.1%}")

                        win_rate_random = win_rate_vs_random(
                            model, eval_env, n_games=eval_games // 2, device=device, seed=0
                        )
                        typer.echo(f"  >> Win rate vs random:  {win_rate_random:.1%}")

                        if prev_model is not None:
                            wr_vs_prev = win_rate_vs_model(
                                model, prev_model, eval_env, n_games=eval_games // 2, device=device
                            )
                            typer.echo(f"  >> Win rate vs prev checkpoint: {wr_vs_prev:.1%}")
                    except requests.RequestException as exc:
                        typer.echo(f"  >> Evaluation skipped (server error): {exc}", err=True)

                    wr_str = f"{win_rate:.2f}" if win_rate is not None else "na"
                    ckpt_path = checkpoint_dir / f"model_iter{iteration:04d}_wr{wr_str}.pt"
                    _save_checkpoint(ckpt_path, iteration, model, optimizer, win_rate)
                    typer.echo(f"  >> Checkpoint saved: {ckpt_path}")

                    if win_rate is not None and win_rate > best_win_rate:
                        best_win_rate = win_rate
                        _save_checkpoint(
                            checkpoint_dir / "best.pt", iteration, model, optimizer, win_rate
                        )
                        typer.echo(f"  >> New best model (win rate: {win_rate:.1%})")

                    # Snapshot current model for next checkpoint comparison.
                    # load_state_dict already copies parameters, so a deepcopy
                    # of the source dict would just waste memory.
                    prev_model = new_like(model)
                    prev_model.load_state_dict(model.state_dict())
                    prev_model.eval()

                writer.writerow([
                    iteration,
                    n_transitions,
                    n_segments,
                    completed_games,
                    f"{losses['policy_loss']:.6f}",
                    f"{losses['value_loss']:.6f}",
                    f"{losses['entropy']:.6f}",
                    f"{config.entropy_coef:.6f}",
                    f"{losses.get('kl', 0.0):.6f}",
                    f"{losses.get('grad_norm', 0.0):.6f}",
                    f"{losses.get('trainable_frac', 1.0):.4f}",
                    len(opponent_pool),
                    f"{win_rate:.4f}" if win_rate is not None else "",
                    f"{win_rate_random:.4f}" if win_rate_random is not None else "",
                ])
                log_file.flush()

                if iteration % checkpoint_every == 0:
                    _save_checkpoint(
                        checkpoint_dir / "latest.pt", iteration, model, optimizer,
                        opponent_pool=opponent_pool,
                    )
    finally:
        env.close()
        eval_env.close()


if __name__ == "__main__":
    app()
