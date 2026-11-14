"""
PPO self-play training loop for Splendor Duel.

Run the game-sim server first:
    cd packages/ai-game-sim && npm run dev

Choosing best.pt
----------------
best.pt used to be whichever checkpoint scored the highest win rate against
the scripted greedy agent.  That bar is noisy (fresh random deals, +/-3.5
points over 200 games) and it saturates: once the model beats greedy almost
every time, later improvements are invisible to it.

A checkpoint now replaces best.pt only by beating it head-to-head, on a fixed
set of seeded deals each played from both seats, by at least
`--promote-threshold`.  Both play greedily, so the match is deterministic.  The
greedy and random win rates are still measured and logged as absolute
reference points.
"""

from __future__ import annotations

import csv
import time
from pathlib import Path
from pickle import UnpicklingError

import numpy as np
import requests
import torch
import typer
from torch import optim

from .env import VecSplendorDuelEnv
from .evaluate import win_rate_vs_greedy, win_rate_vs_model, win_rate_vs_random
from .model import ActorCriticNet, build_from_checkpoint, new_like
from .ppo import PPOConfig, update
from .schedule import Schedule
from .self_play import OpponentPool, RolloutCollector

app = typer.Typer(add_completion=False)


# Resolved once at import rather than inside the CLI signature: a call in a
# parameter default is evaluated at definition time anyway, so a constant says
# so plainly -- packages/ai-trainer/checkpoints, three levels up from this file.
_DEFAULT_CHECKPOINT_DIR = Path(__file__).resolve().parent.parent.parent / "checkpoints"

# v8: the opponent's reserved cards are hidden from the observation, and every
# card carries affordability features (28 per card, was 24).  Input shapes
# changed, and v7 policies relied on information they will not have in play,
# so v7 checkpoints are not loaded.
CHECKPOINT_VERSION = 8

_DEFAULT_LR = 3e-4
_DEFAULT_ENTROPY_COEF = 0.01
_DEFAULT_ENTROPY_COEF_FINAL = 0.001

# torch.load raises any of the first four on a truncated or corrupt archive; the
# last three cover a best.pt whose payload is not the mapping this file writes
# (`.get` on a non-mapping, `float()` on a non-numeric win rate). Anything else
# is a bug worth surfacing, so it is deliberately left to propagate.
_CHECKPOINT_READ_ERRORS = (
    OSError,
    RuntimeError,
    EOFError,
    UnpicklingError,
    AttributeError,
    TypeError,
    ValueError,
)

# Transient network errors get retried with exponential backoff before the
# run surrenders.  HTTP errors from the server (4xx/5xx) are not retried --
# those indicate a real problem, not a blip.
_COLLECT_RETRY_ATTEMPTS = 4
_COLLECT_RETRY_BASE_DELAY = 1.0  # seconds

_LOG_COLUMNS = [
    "iteration",
    "transitions",
    "segments",
    "completed_games",
    "policy_loss",
    "value_loss",
    "entropy",
    "entropy_coef",
    "kl",
    "grad_norm",
    "trainable_frac",
    "pool_size",
    "win_rate_vs_greedy",
    "win_rate_vs_random",
    "win_rate_vs_best",
    "promoted",
    "updates",
    "early_stopped",
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
            delay = _COLLECT_RETRY_BASE_DELAY * (2**attempt)
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
    schedule: Schedule,
    win_rate: float | None = None,
    opponent_pool: OpponentPool | None = None,
) -> None:
    payload: dict = {
        "version": CHECKPOINT_VERSION,
        "iteration": iteration,
        "arch": model.arch,
        "model_state": model.state_dict(),
        "optimizer_state": optimizer.state_dict(),
        # Persisted so a resumed run continues the same LR / entropy curves
        # instead of restarting them (see schedule.py).
        "schedule": schedule.to_dict(),
    }
    if win_rate is not None:
        payload["win_rate"] = win_rate
    if opponent_pool is not None and len(opponent_pool) > 0:
        # Persisted so a resumed run keeps its league instead of restarting
        # self-play against a single fresh opponent.
        payload["opponent_pool"] = opponent_pool.state_dicts()
    torch.save(payload, path)


def _prepare_log(log_path: Path) -> bool:
    """
    Make the CSV log safe to append to; returns True when it needs a header.

    Appending rows to a file whose header names different columns makes it
    unreadable as CSV, so an old-format log is moved aside rather than extended.
    """
    header = ",".join(_LOG_COLUMNS)
    if log_path.exists():
        with open(log_path, newline="") as existing:
            first = existing.readline().strip()
        if first != header:
            n = 1
            while (aside := log_path.with_name(f"{log_path.stem}.old{n}.csv")).exists():
                n += 1
            log_path.rename(aside)
            typer.echo(f"Log columns changed; moved the old log to {aside.name}", err=True)
    return not log_path.exists()


def _load_best(path: Path, device: torch.device) -> ActorCriticNet | None:
    """The current best model, or None when there is no comparable best.pt."""
    if not path.exists():
        return None
    try:
        saved = torch.load(path, map_location=device, weights_only=True)
        if saved.get("version", 0) != CHECKPOINT_VERSION:
            # A model from a different observation layout cannot even be run.
            typer.echo(
                f"Ignoring {path.name} from checkpoint version {saved.get('version', 0)}; "
                "the next evaluated checkpoint becomes the new best.",
                err=True,
            )
            return None
        best = build_from_checkpoint(saved).to(device)
        best.load_state_dict(saved["model_state"])
        best.eval()
        typer.echo(f"Loaded current best from {path.name} (iteration {saved.get('iteration')})")
        return best
    except (*_CHECKPOINT_READ_ERRORS, KeyError) as exc:
        # Not worth ending a run over, but worth saying: silently treating an
        # unreadable best.pt as absent would let the next save overwrite a file
        # that may be recoverable.
        typer.echo(
            f"Could not read {path.name} ({type(exc).__name__}: {exc}); "
            "the next evaluated checkpoint becomes the new best.",
            err=True,
        )
        return None


def _snapshot(model: ActorCriticNet) -> ActorCriticNet:
    """A frozen copy of `model` in eval mode."""
    copy_ = new_like(model)
    copy_.load_state_dict(model.state_dict())
    copy_.eval()
    return copy_


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
    checkpoint_dir: Path = typer.Option(_DEFAULT_CHECKPOINT_DIR, help="Checkpoint directory"),
    lr: float | None = typer.Option(
        None, help=f"Base learning rate [default: {_DEFAULT_LR}; on resume, the checkpoint's]"
    ),
    lr_decay: bool | None = typer.Option(
        None,
        "--lr-decay/--no-lr-decay",
        help="Linearly decay LR to 5% over the schedule horizon "
        "[default: on; on resume, the checkpoint's]",
    ),
    entropy_coef: float | None = typer.Option(
        None,
        help=f"Initial entropy coefficient [default: {_DEFAULT_ENTROPY_COEF}; "
        "on resume, the checkpoint's]",
    ),
    entropy_coef_final: float | None = typer.Option(
        None,
        help=f"Entropy coefficient at the horizon [default: {_DEFAULT_ENTROPY_COEF_FINAL}; "
        "on resume, the checkpoint's]",
    ),
    schedule_horizon: int | None = typer.Option(
        None,
        help="Global iteration at which LR and entropy reach their final values "
        "[default: the last iteration of a fresh run; on resume, the checkpoint's]. "
        "Raise it to extend a finished run.",
    ),
    target_kl: float = typer.Option(
        0.03, help="Stop a PPO update once minibatch KL exceeds 1.5x this; 0 disables"
    ),
    parallel_envs: int = typer.Option(32, help="Games stepped in lockstep during rollouts"),
    trunk_depth: int = typer.Option(4, help="Residual blocks in the trunk"),
    trunk_width: int = typer.Option(512, help="Width of the residual trunk"),
    eval_envs: int = typer.Option(16, help="Games stepped in lockstep during evaluation"),
    eval_seed: int = typer.Option(
        2024, help="Seed for the fixed evaluation deals, so every checkpoint plays the same games"
    ),
    promote_threshold: float = typer.Option(
        0.55, help="Head-to-head win rate against best.pt a checkpoint needs to replace it"
    ),
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
    optimizer = optim.Adam(model.parameters(), lr=lr or _DEFAULT_LR)
    config = PPOConfig(target_kl=target_kl if target_kl > 0 else None)
    opponent_pool = OpponentPool(max_size=opponent_pool_size, rng=rng)
    collector = RolloutCollector(model, env, device=device, opponent_pool=opponent_pool, rng=rng)

    start_iteration = 1
    saved_schedule: dict = {}
    if resume is not None:
        if not resume.exists():
            typer.echo(f"ERROR: checkpoint not found: {resume}", err=True)
            raise typer.Exit(code=1)
        ckpt = torch.load(resume, map_location=device, weights_only=True)
        ckpt_version = ckpt.get("version", 0)
        if ckpt_version != CHECKPOINT_VERSION:
            # Every version bump so far has changed the observation or the
            # action layout, so an old checkpoint's weights cannot be reused.
            typer.echo(
                f"ERROR: {resume} is checkpoint version {ckpt_version}; this trainer "
                f"needs version {CHECKPOINT_VERSION}. Start a fresh run instead.",
                err=True,
            )
            raise typer.Exit(code=1)

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
            optimizer = optim.Adam(model.parameters(), lr=lr or _DEFAULT_LR)
            collector.model = model
            n_params = sum(p.numel() for p in model.parameters())
            typer.echo(f"Model parameters: {n_params:,}")
        model.load_state_dict(ckpt["model_state"])
        optimizer.load_state_dict(ckpt["optimizer_state"])

        start_iteration = ckpt["iteration"] + 1
        saved_schedule = ckpt.get("schedule", {})
        saved_pool = ckpt.get("opponent_pool")
        if saved_pool:
            opponent_pool.load(saved_pool)
            typer.echo(f"Restored opponent pool ({len(opponent_pool)} checkpoints)")
        typer.echo(f"Resumed from {resume} (iteration {ckpt['iteration']})")

    last_iteration = start_iteration + iterations - 1

    def pick(cli_value, key: str, default):
        """An explicit flag wins, then the resumed checkpoint, then the default."""
        if cli_value is not None:
            return cli_value
        return saved_schedule.get(key, default)

    schedule = Schedule(
        horizon=pick(schedule_horizon, "horizon", last_iteration),
        base_lr=pick(lr, "base_lr", _DEFAULT_LR),
        lr_decay=pick(lr_decay, "lr_decay", True),
        entropy_coef=pick(entropy_coef, "entropy_coef", _DEFAULT_ENTROPY_COEF),
        entropy_coef_final=pick(
            entropy_coef_final, "entropy_coef_final", _DEFAULT_ENTROPY_COEF_FINAL
        ),
    )
    typer.echo(
        f"Schedule: horizon={schedule.horizon}  base_lr={schedule.base_lr:.2e}  "
        f"lr_decay={schedule.lr_decay}  entropy {schedule.entropy_coef} -> "
        f"{schedule.entropy_coef_final}"
    )
    if last_iteration > schedule.horizon:
        typer.echo(
            f"Note: this run goes past the schedule horizon ({schedule.horizon}); "
            "LR and entropy stay at their final values from there on.",
            err=True,
        )

    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    best_ckpt_path = checkpoint_dir / "best.pt"
    best_model = _load_best(best_ckpt_path, device)

    log_path = checkpoint_dir / "training_log.csv"

    log_needs_header = _prepare_log(log_path)
    try:
        with open(log_path, "a", newline="") as log_file:
            writer = csv.writer(log_file)
            if log_needs_header:
                writer.writerow(_LOG_COLUMNS)
            for iteration in range(start_iteration, last_iteration + 1):
                for pg in optimizer.param_groups:
                    pg["lr"] = schedule.lr(iteration)
                # Anneal exploration down over the run.  A constant high
                # coefficient pins the policy near-uniform: the entropy term
                # then dominates the loss and the agent never commits to a plan.
                config.entropy_coef = schedule.entropy(iteration)

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
                        checkpoint_dir / "latest.pt",
                        iteration - 1,
                        model,
                        optimizer,
                        schedule,
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
                wc_str = (
                    "  ".join(f"{k}={v}" for k, v in sorted(win_condition_counts.items())) or "none"
                )
                kl_val = losses.get("kl", 0.0)
                pool_str = f"  vs_pool={pool_wins}/{pool_games}" if pool_games else ""
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
                    f"grad_norm={losses.get('grad_norm', 0.0):.3f}  "
                    f"updates={losses['updates']}"
                    + ("  (early stop: KL)" if losses["early_stopped"] else "")
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
                win_rate_best: float | None = None
                promoted = False

                if iteration % eval_every == 0:
                    try:
                        win_rate = win_rate_vs_greedy(
                            model, eval_env, n_games=eval_games, device=device, seed=eval_seed
                        )
                        typer.echo(f"  >> Win rate vs greedy:  {win_rate:.1%}")

                        win_rate_random = win_rate_vs_random(
                            model, eval_env, n_games=eval_games // 2, device=device, seed=eval_seed
                        )
                        typer.echo(f"  >> Win rate vs random:  {win_rate_random:.1%}")

                        if best_model is None:
                            promoted = True
                        else:
                            win_rate_best = win_rate_vs_model(
                                model,
                                best_model,
                                eval_env,
                                n_games=eval_games,
                                device=device,
                                seed=eval_seed,
                            )
                            promoted = win_rate_best >= promote_threshold
                            typer.echo(
                                f"  >> Win rate vs best:    {win_rate_best:.1%} "
                                f"(needs {promote_threshold:.0%})"
                            )
                    except requests.RequestException as exc:
                        typer.echo(f"  >> Evaluation skipped (server error): {exc}", err=True)

                    wr_str = f"{win_rate:.2f}" if win_rate is not None else "na"
                    ckpt_path = checkpoint_dir / f"model_iter{iteration:04d}_wr{wr_str}.pt"
                    _save_checkpoint(ckpt_path, iteration, model, optimizer, schedule, win_rate)
                    typer.echo(f"  >> Checkpoint saved: {ckpt_path}")

                    if promoted:
                        _save_checkpoint(
                            best_ckpt_path, iteration, model, optimizer, schedule, win_rate
                        )
                        best_model = _snapshot(model)
                        typer.echo("  >> New best model")

                writer.writerow(
                    [
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
                        f"{win_rate_best:.4f}" if win_rate_best is not None else "",
                        int(promoted),
                        losses["updates"],
                        int(losses["early_stopped"]),
                    ]
                )
                log_file.flush()

                if iteration % checkpoint_every == 0:
                    _save_checkpoint(
                        checkpoint_dir / "latest.pt",
                        iteration,
                        model,
                        optimizer,
                        schedule,
                        opponent_pool=opponent_pool,
                    )
    finally:
        env.close()
        eval_env.close()


if __name__ == "__main__":
    app()
