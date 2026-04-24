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
    terminal_value: float = 0.0,
) -> tuple[list[float], list[float]]:
    """
    Compute GAE advantages and discounted returns for a two-player zero-sum game.

    Observations are always encoded from the current player's perspective, so
    consecutive steps from different players have values in opposite frames:
    V_opponent(s) ≈ -V_current(s).  When the next step belongs to the opponent,
    both the bootstrap value and the accumulated GAE term must be negated to
    convert them to the current player's perspective before computing the TD error.

    terminal_value: value estimate of the state after the last transition.
    Non-zero only for episodes truncated by a step cap (not naturally terminal).
    """
    n = len(rewards)
    advantages = [0.0] * n
    returns = [0.0] * n
    gae = 0.0
    next_value = terminal_value

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

        advantages, returns = _compute_gae(rewards, values, dones, player_ids, config.gamma, config.lam, ep.terminal_value)

        for i, t in enumerate(ep.transitions):
            all_obs.append(t.obs)
            all_actions.append(t.action)
            all_log_probs_old.append(t.log_prob)
            all_advantages.append(advantages[i])
            all_returns.append(returns[i])
            all_masks.append(t.legal_mask)

    # Normalise advantages globally across the entire rollout batch.
    adv_arr = np.asarray(all_advantages, dtype=np.float32)
    adv_arr = (adv_arr - adv_arr.mean()) / (adv_arr.std() + 1e-6)
    adv_clip_hits = int(((adv_arr > 5.0) | (adv_arr < -5.0)).sum())
    np.clip(adv_arr, -5.0, 5.0, out=adv_arr)

    # Single-copy transfer: list-of-arrays → stacked numpy → torch on device.
    obs_t = torch.from_numpy(np.stack(all_obs).astype(np.float32, copy=False)).to(
        device, non_blocking=True
    )
    masks_t = torch.from_numpy(np.stack(all_masks).astype(np.bool_, copy=False)).to(
        device, non_blocking=True
    )
    actions_t = torch.from_numpy(np.asarray(all_actions, dtype=np.int64)).to(
        device, non_blocking=True
    )
    log_probs_old_t = torch.from_numpy(
        np.asarray(all_log_probs_old, dtype=np.float32)
    ).to(device, non_blocking=True)
    advantages_t = torch.from_numpy(adv_arr).to(device, non_blocking=True)
    returns_t = torch.from_numpy(np.asarray(all_returns, dtype=np.float32)).to(
        device, non_blocking=True
    )

    # Precompute the inverted legal mask once — it's referenced every minibatch.
    inv_masks_t = ~masks_t

    n = len(all_obs)
    # Accumulate loss components on-device and sync only once at the end,
    # instead of calling .item() on every minibatch.
    total_policy_loss = torch.zeros((), device=device)
    total_value_loss = torch.zeros((), device=device)
    total_entropy = torch.zeros((), device=device)
    n_updates = 0

    model.train()
    for _ in range(config.n_epochs):
        perm = torch.randperm(n, device=device)
        for start in range(0, n, config.batch_size):
            idx = perm[start : start + config.batch_size]

            logits, values = model(obs_t[idx])
            logits_masked = logits.masked_fill(inv_masks_t[idx], float("-inf"))
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

            total_policy_loss += policy_loss.detach()
            total_value_loss += value_loss.detach()
            total_entropy += entropy.detach()
            n_updates += 1

    # Single GPU→CPU sync after all minibatches.
    pl = float(total_policy_loss.item()) / n_updates
    vl = float(total_value_loss.item()) / n_updates
    ent = float(total_entropy.item()) / n_updates
    if not (np.isfinite(pl) and np.isfinite(vl) and np.isfinite(ent)):
        raise ValueError(
            f"NaN/Inf in PPO loss: policy_loss={pl:.4f}  "
            f"value_loss={vl:.4f}  entropy={ent:.4f}"
        )

    return {
        "policy_loss": pl,
        "value_loss": vl,
        "entropy": ent,
        "adv_clip_frac": adv_clip_hits / max(n, 1),
    }
