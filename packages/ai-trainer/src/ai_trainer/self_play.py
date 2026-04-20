"""
Self-play data collection.

Both sides of each game use the same model. The collected transitions
are used as training data for PPO.

MAX_STEPS_PER_EPISODE caps each game to guard against infinite loops caused
by bugs in the game engine or an adversarial action-masking edge case.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import torch

from .env import SplendorDuelEnv
from .model import ActorCriticNet

MAX_STEPS_PER_EPISODE = 2_000


@dataclass
class Transition:
    obs: np.ndarray           # (858,)
    action: int
    log_prob: float
    value: float
    reward: float
    done: bool
    legal_mask: np.ndarray    # (3981,)
    player_id: int            # 0 or 1 — index of the player who acted


@dataclass
class Episode:
    transitions: list[Transition] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.transitions)


@torch.no_grad()
def collect_episodes(
    model: ActorCriticNet,
    env: SplendorDuelEnv,
    n_episodes: int,
    device: torch.device | None = None,
) -> list[Episode]:
    """
    Play n_episodes games using model for both sides.
    Returns a list of Episode objects containing all transitions.
    """
    if device is None:
        device = next(model.parameters()).device

    model.eval()
    episodes: list[Episode] = []

    for _ in range(n_episodes):
        obs_np, info = env.reset()
        episode = Episode()
        done = False

        for _ in range(MAX_STEPS_PER_EPISODE):
            if done:
                break
            obs_t = torch.tensor(obs_np, dtype=torch.float32, device=device).unsqueeze(0)
            mask_np = info["legal_mask"].copy()  # mask for the current state
            mask_t = torch.tensor(mask_np, dtype=torch.bool, device=device).unsqueeze(0)

            if not mask_t.any():
                legal_moves = info.get("legal_moves", [])
                raise RuntimeError(
                    "legal_mask is all-False — no legal action could be mapped to a "
                    "canonical index.\n"
                    f"  legal_moves from server ({len(legal_moves)} entries): {legal_moves}\n"
                    f"  state: {info.get('state')}"
                )

            logits, value_t = model(obs_t)
            logits_masked = logits.masked_fill(~mask_t, float("-inf"))
            dist = torch.distributions.Categorical(logits=logits_masked)

            action = dist.sample()
            log_prob = dist.log_prob(action)

            action_int = int(action.item())
            # Record the acting player BEFORE env.step() advances the state.
            acting_player_id: int = info["state"].get("currentPlayer", 0)
            obs_np, reward, done, _, info = env.step(action_int)

            episode.transitions.append(
                Transition(
                    obs=obs_t.squeeze(0).cpu().numpy(),
                    action=action_int,
                    log_prob=float(log_prob.item()),
                    value=value_t.item(),
                    reward=float(reward),
                    done=done,
                    legal_mask=mask_np,  # mask for the state where the action was taken
                    player_id=acting_player_id,
                )
            )

        episodes.append(episode)

    return episodes
