"""
PPO update with action masking and GAE advantage estimation.

Hyperparameters:
  clip_eps     = 0.2
  entropy_coef = 0.05
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
from .state_encoder import STATE_DIM
from .action_space import ACTION_SPACE_SIZE

_ADV_STD_EPSILON = 1e-6   # prevents division by zero in advantage normalisation
_ADV_CLIP_RANGE = 5.0     # clip normalised advantages to ±5σ


@dataclass
class PPOConfig:
    clip_eps: float = 0.2
    entropy_coef: float = 0.05
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
    out_advantages: np.ndarray,
    out_returns: np.ndarray,
    terminal_value: float = 0.0,
    terminal_player_id: int = 0,
) -> None:
    """
    Compute GAE advantages and discounted returns for a two-player zero-sum game,
    writing results directly into caller-provided arrays (no intermediate allocation).

    Observations are always encoded from the current player's perspective, so
    consecutive steps from different players have values in opposite frames:
    V_opponent(s) ≈ -V_current(s).  When the next step belongs to the opponent,
    both the bootstrap value and the accumulated GAE term must be negated to
    convert them to the current player's perspective before computing the TD error.

    terminal_value: value estimate of the state after the last transition,
    encoded from terminal_player_id's perspective.  Non-zero only for episodes
    truncated by a step cap (not naturally terminal).  When terminal_player_id
    differs from the last acting player, terminal_value must be negated to
    convert it to that player's frame before bootstrapping GAE.
    """
    n = len(rewards)
    gae = 0.0
    # Flip terminal_value if it's in the opponent's frame relative to the last actor.
    last_player = player_ids[n - 1] if n else 0
    next_value = -terminal_value if terminal_player_id != last_player else terminal_value

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
        out_advantages[t] = gae
        out_returns[t] = gae + values[t]
        next_value = values[t]


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

    # Pre-allocate flat buffers for all transitions up front, avoiding repeated
    # list appends and a separate np.stack / np.asarray pass at the end.
    n = sum(len(ep) for ep in episodes)
    all_obs = np.empty((n, STATE_DIM), dtype=np.float32)
    all_masks = np.empty((n, ACTION_SPACE_SIZE), dtype=np.bool_)
    all_actions = np.empty(n, dtype=np.int64)
    all_log_probs_old = np.empty(n, dtype=np.float32)
    all_advantages = np.empty(n, dtype=np.float32)
    all_returns = np.empty(n, dtype=np.float32)
    all_values_old = np.empty(n, dtype=np.float32)

    ptr = 0
    for ep in episodes:
        ep_n = len(ep.transitions)
        rewards = [t.reward for t in ep.transitions]
        values = [t.value for t in ep.transitions]
        dones = [t.done for t in ep.transitions]
        player_ids = [t.player_id for t in ep.transitions]

        _compute_gae(
            rewards, values, dones, player_ids,
            config.gamma, config.lam,
            all_advantages[ptr : ptr + ep_n],
            all_returns[ptr : ptr + ep_n],
            ep.terminal_value, ep.terminal_player_id,
        )

        for i, t in enumerate(ep.transitions):
            all_obs[ptr + i] = t.obs
            all_masks[ptr + i] = t.legal_mask
            all_actions[ptr + i] = t.action
            all_log_probs_old[ptr + i] = t.log_prob
            all_values_old[ptr + i] = t.value
        ptr += ep_n

    # Normalise advantages in-place — avoids a temporary array allocation.
    adv_arr = all_advantages  # already float32
    adv_arr -= adv_arr.mean()
    adv_arr /= adv_arr.std() + _ADV_STD_EPSILON
    adv_clip_hits = int(((adv_arr > _ADV_CLIP_RANGE) | (adv_arr < -_ADV_CLIP_RANGE)).sum())
    np.clip(adv_arr, -_ADV_CLIP_RANGE, _ADV_CLIP_RANGE, out=adv_arr)

    # Single-copy transfer to device.
    obs_t = torch.from_numpy(all_obs).to(device, non_blocking=True)
    masks_t = torch.from_numpy(all_masks).to(device, non_blocking=True)
    actions_t = torch.from_numpy(all_actions).to(device, non_blocking=True)
    log_probs_old_t = torch.from_numpy(all_log_probs_old).to(device, non_blocking=True)
    advantages_t = torch.from_numpy(adv_arr).to(device, non_blocking=True)
    returns_t = torch.from_numpy(all_returns).to(device, non_blocking=True)
    values_old_t = torch.from_numpy(all_values_old).to(device, non_blocking=True)

    # Precompute the inverted legal mask once — it's referenced every minibatch.
    inv_masks_t = ~masks_t
    # Accumulate loss components on-device and sync only once at the end,
    # instead of calling .item() on every minibatch.
    total_policy_loss = torch.zeros((), device=device)
    total_value_loss = torch.zeros((), device=device)
    total_entropy = torch.zeros((), device=device)
    total_kl = torch.zeros((), device=device)
    total_grad_norm = 0.0
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

            # Clipped value loss: prevents value function from moving too far from
            # the rollout estimate, mirroring the policy clip for stability.
            values_sq = values.squeeze(-1)
            values_old_b = values_old_t[idx]
            values_clipped = values_old_b + torch.clamp(
                values_sq - values_old_b, -config.clip_eps, config.clip_eps
            )
            value_loss = torch.max(
                nn.functional.mse_loss(values_sq, returns_t[idx]),
                nn.functional.mse_loss(values_clipped, returns_t[idx]),
            )

            # Approximate KL divergence for monitoring policy change per update.
            kl = (log_probs_old_t[idx] - log_probs).mean()

            loss = policy_loss + config.value_coef * value_loss - config.entropy_coef * entropy

            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            grad_norm = float(nn.utils.clip_grad_norm_(model.parameters(), max_norm=config.max_grad_norm))
            optimizer.step()

            total_policy_loss += policy_loss.detach()
            total_value_loss += value_loss.detach()
            total_entropy += entropy.detach()
            total_kl += kl.detach()
            total_grad_norm += grad_norm
            n_updates += 1

    # Single GPU→CPU sync after all minibatches.
    pl = float(total_policy_loss.item()) / n_updates
    vl = float(total_value_loss.item()) / n_updates
    ent = float(total_entropy.item()) / n_updates
    kl = float(total_kl.item()) / n_updates
    gn = total_grad_norm / n_updates
    if not (np.isfinite(pl) and np.isfinite(vl) and np.isfinite(ent) and np.isfinite(kl)):
        raise ValueError(
            f"NaN/Inf in PPO update: policy_loss={pl:.4f}  "
            f"value_loss={vl:.4f}  entropy={ent:.4f}  kl={kl:.4f}"
        )

    return {
        "policy_loss": pl,
        "value_loss": vl,
        "entropy": ent,
        "kl": kl,
        "grad_norm": gn,
        "adv_clip_frac": adv_clip_hits / max(n, 1),
    }
