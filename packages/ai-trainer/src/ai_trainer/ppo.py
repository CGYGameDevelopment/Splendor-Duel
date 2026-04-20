"""
PPO update with action masking and GAE advantage estimation.

Hyperparameters:
  clip_eps     = 0.2
  entropy_coef = 0.01
  value_coef   = 0.5
  gamma        = 0.99
  lam          = 0.95  (GAE lambda)
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim

from .self_play import Episode
from .model import ActorCriticNet


@dataclass
class PPOConfig:
    clip_eps: float = 0.2
    entropy_coef: float = 0.01
    value_coef: float = 0.5
    gamma: float = 0.99
    lam: float = 0.95
    n_epochs: int = 4
    batch_size: int = 256
    max_grad_norm: float = 0.5


def _compute_gae(
    rewards: list[float],
    values: list[float],
    dones: list[bool],
    player_ids: list[int],
    gamma: float,
    lam: float,
) -> tuple[list[float], list[float]]:
    """
    Compute GAE advantages and discounted returns for a two-player zero-sum game.

    Observations are always encoded from the current player's perspective, so
    consecutive steps from different players have values in opposite frames:
    V_opponent(s) ≈ -V_current(s).  When the next step belongs to the opponent,
    both the bootstrap value and the accumulated GAE term must be negated to
    convert them to the current player's perspective before computing the TD error.
    """
    n = len(rewards)
    advantages = [0.0] * n
    returns = [0.0] * n
    gae = 0.0
    next_value = 0.0

    for t in reversed(range(n)):
        mask = 0.0 if dones[t] else 1.0
        # If the next step was taken by the opponent, its value estimate is from
        # the opponent's frame.  Negate to convert to current player's frame.
        if t + 1 < n and player_ids[t + 1] != player_ids[t]:
            nv = -next_value
            ng = -gae
        else:
            nv = next_value
            ng = gae
        delta = rewards[t] + gamma * nv * mask - values[t]
        gae = delta + gamma * lam * mask * ng
        advantages[t] = gae
        returns[t] = advantages[t] + values[t]
        next_value = values[t]

    return advantages, returns


def update(
    model: ActorCriticNet,
    optimizer: optim.Optimizer,
    episodes: list[Episode],
    config: PPOConfig | None = None,
    device: torch.device | None = None,
) -> dict[str, float]:
    """
    Run PPO update on a batch of episodes.
    Returns a dict with loss components for logging.
    """
    if config is None:
        config = PPOConfig()
    if device is None:
        device = next(model.parameters()).device

    # Flatten all episodes into per-transition lists
    all_obs, all_actions, all_log_probs_old = [], [], []
    all_advantages, all_returns, all_masks = [], [], []

    for ep in episodes:
        rewards = [t.reward for t in ep.transitions]
        values = [t.value for t in ep.transitions]
        dones = [t.done for t in ep.transitions]
        player_ids = [t.player_id for t in ep.transitions]

        advantages, returns = _compute_gae(rewards, values, dones, player_ids, config.gamma, config.lam)

        for i, t in enumerate(ep.transitions):
            all_obs.append(t.obs)
            all_actions.append(t.action)
            all_log_probs_old.append(t.log_prob)
            all_advantages.append(advantages[i])
            all_returns.append(returns[i])
            all_masks.append(t.legal_mask)

    # Normalise advantages globally across the entire rollout batch
    adv_arr = np.array(all_advantages, dtype=np.float32)
    adv_arr = (adv_arr - adv_arr.mean()) / (adv_arr.std() + 1e-6)
    adv_arr = np.clip(adv_arr, -5.0, 5.0)
    all_advantages = adv_arr.tolist()

    obs_t = torch.tensor(np.array(all_obs), dtype=torch.float32, device=device)
    actions_t = torch.tensor(all_actions, dtype=torch.long, device=device)
    log_probs_old_t = torch.tensor(all_log_probs_old, dtype=torch.float32, device=device)
    advantages_t = torch.tensor(all_advantages, dtype=torch.float32, device=device)
    returns_t = torch.tensor(all_returns, dtype=torch.float32, device=device)
    masks_t = torch.tensor(np.array(all_masks), dtype=torch.bool, device=device)

    n = len(all_obs)
    total_policy_loss = 0.0
    total_value_loss = 0.0
    total_entropy = 0.0
    n_updates = 0

    model.train()
    for _ in range(config.n_epochs):
        perm = torch.randperm(n, device=device)
        for start in range(0, n, config.batch_size):
            idx = perm[start : start + config.batch_size]

            logits, values = model(obs_t[idx])
            logits_masked = logits.masked_fill(~masks_t[idx], float("-inf"))
            dist = torch.distributions.Categorical(logits=logits_masked)

            log_probs = dist.log_prob(actions_t[idx])
            entropy = dist.entropy().mean()

            ratio = torch.exp(log_probs - log_probs_old_t[idx])
            adv = advantages_t[idx]

            policy_loss = -torch.min(
                ratio * adv,
                torch.clamp(ratio, 1 - config.clip_eps, 1 + config.clip_eps) * adv,
            ).mean()

            value_loss = nn.functional.mse_loss(values.squeeze(-1), returns_t[idx])

            loss = policy_loss + config.value_coef * value_loss - config.entropy_coef * entropy

            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=config.max_grad_norm)
            optimizer.step()

            total_policy_loss += policy_loss.item()
            total_value_loss += value_loss.item()
            total_entropy += entropy.item()
            n_updates += 1

    return {
        "policy_loss": total_policy_loss / n_updates,
        "value_loss": total_value_loss / n_updates,
        "entropy": total_entropy / n_updates,
    }
