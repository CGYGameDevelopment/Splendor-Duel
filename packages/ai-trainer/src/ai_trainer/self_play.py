"""
Self-play data collection.

Both sides of each game use the same model. The collected transitions
are used as training data for PPO.

MAX_STEPS_PER_EPISODE caps each game to guard against infinite loops caused
by bugs in the game engine or an adversarial action-masking edge case.

Rollouts can be parallelised across multiple envs.  Each env holds its own
HTTP session against the game-sim server; running them in a thread pool hides
HTTP latency behind GPU/Python work on the other episodes.  Torch inference
is thread-safe under @torch.inference_mode() with the model in eval mode, so all
threads share a single model instance.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import numpy as np
import torch

from .env import SplendorDuelEnv
from .model import ActorCriticNet
from .state_encoder import STATE_DIM
from .action_space import ACTION_SPACE_SIZE

MAX_STEPS_PER_EPISODE = 2_000


@dataclass
class Transition:
    obs: np.ndarray           # (STATE_DIM,)
    action: int
    log_prob: float
    value: float
    reward: float
    done: bool
    legal_mask: np.ndarray    # (ACTION_SPACE_SIZE,)
    player_id: int            # 0 or 1 — index of the player who acted


@dataclass
class Episode:
    transitions: list[Transition] = field(default_factory=list)
    # Value estimate for the state after the last transition.
    # Non-zero only for episodes truncated by MAX_STEPS_PER_EPISODE (not naturally terminal).
    terminal_value: float = 0.0
    # Player whose turn it is AFTER the last transition (used to correct perspective
    # when bootstrapping terminal_value into GAE for truncated episodes).
    terminal_player_id: int = 0
    # 'prestige', 'crowns', 'color_prestige', or None for truncated episodes.
    win_condition: str | None = None

    def __len__(self) -> int:
        return len(self.transitions)


@torch.inference_mode()
def _play_one_episode(
    model: ActorCriticNet,
    env: SplendorDuelEnv,
    device: torch.device,
) -> Episode:
    """Play one game to completion and return its Episode."""
    # Pre-allocated single-sample inference buffers, reused across every step
    # of this episode to avoid a fresh allocation per decision.
    obs_buf = torch.empty((1, STATE_DIM), dtype=torch.float32, device=device)
    mask_buf = torch.empty((1, ACTION_SPACE_SIZE), dtype=torch.bool, device=device)

    obs_np, info = env.reset()
    episode = Episode()
    done = False

    for _ in range(MAX_STEPS_PER_EPISODE):
        if done:
            break

        mask_np = info["legal_mask"]  # owned by env — we store a copy below
        if not mask_np.any():
            raise RuntimeError(
                "legal_mask is all-False — no legal action could be mapped to a "
                "canonical index.\n"
                f"  legal_moves from server ({len(info.get('legal_moves', []))} entries): "
                f"{info.get('legal_moves')}\n"
                f"  state: {info.get('state')}"
            )

        obs_buf.copy_(torch.from_numpy(obs_np).unsqueeze(0), non_blocking=True)
        mask_buf.copy_(torch.from_numpy(mask_np).unsqueeze(0), non_blocking=True)

        logits, value_t = model(obs_buf)
        logits_masked = logits.masked_fill(~mask_buf, float("-inf"))
        dist = torch.distributions.Categorical(logits=logits_masked)

        action = dist.sample()
        log_prob = dist.log_prob(action)

        action_int = int(action.item())
        # Record the acting player BEFORE env.step() advances the state.
        acting_player_id: int = info["state"].get("currentPlayer", 0)

        # Snapshot obs and mask for the transition BEFORE stepping, since env
        # reuses its internal arrays.
        obs_snapshot = obs_np.copy()
        mask_snapshot = mask_np.copy()

        obs_np, reward, done, _, info = env.step(action_int)

        episode.transitions.append(
            Transition(
                obs=obs_snapshot,
                action=action_int,
                log_prob=float(log_prob.item()),
                value=float(value_t.item()),
                reward=float(reward),
                done=done,
                legal_mask=mask_snapshot,
                player_id=acting_player_id,
            )
        )

    if done:
        episode.win_condition = info.get("win_condition")
    else:
        # Episode cut off by step cap — bootstrap terminal value for GAE.
        # Record whose turn it is next so GAE can flip perspective if needed.
        episode.terminal_player_id = info["state"].get("currentPlayer", 0)
        obs_buf.copy_(torch.from_numpy(obs_np).unsqueeze(0), non_blocking=True)
        _, final_value_t = model(obs_buf)
        episode.terminal_value = float(final_value_t.item())

    return episode


@torch.inference_mode()
def collect_episodes(
    model: ActorCriticNet,
    env: SplendorDuelEnv | list[SplendorDuelEnv],
    n_episodes: int,
    device: torch.device | None = None,
) -> list[Episode]:
    """
    Play n_episodes games using model for both sides.

    `env` may be a single env (serial collection) or a list of envs (parallel
    collection, one worker per env).  Returns a list of Episode objects.
    """
    if device is None:
        device = next(model.parameters()).device

    model.eval()

    envs: list[SplendorDuelEnv] = env if isinstance(env, list) else [env]
    assert envs, "collect_episodes: at least one env required"
    n_workers = min(len(envs), n_episodes)

    if n_workers == 1:
        # Serial path — no thread pool overhead.
        return [_play_one_episode(model, envs[0], device) for _ in range(n_episodes)]

    # Each worker owns exactly one env and plays a chunk of episodes serially
    # on it, so the env's HTTP session is never touched by two threads at once.
    chunks = [n_episodes // n_workers] * n_workers
    for i in range(n_episodes % n_workers):
        chunks[i] += 1

    def _run_chunk(worker_env: SplendorDuelEnv, count: int) -> list[Episode]:
        return [_play_one_episode(model, worker_env, device) for _ in range(count)]

    episodes: list[Episode] = []
    with ThreadPoolExecutor(max_workers=n_workers) as pool:
        results = [
            pool.submit(_run_chunk, envs[i], chunks[i])
            for i in range(n_workers) if chunks[i] > 0
        ]
        for fut in results:
            episodes.extend(fut.result())
    return episodes
