"""
PPO update with action masking and GAE advantage estimation.

Hyperparameters:
  clip_eps     = 0.2
  entropy_coef = 0.01   (annealed towards entropy_coef_final by train.py)
  value_coef   = 0.5
  gamma        = 1.0
  lam          = 0.97   (GAE lambda)

On gamma
--------
The only reward in this game is +/-1 at the end, and a game runs ~350
decisions.  With the previous gamma=0.99 the terminal reward reached the
opening attenuated by 0.99^350 ~ 0.03, and GAE's effective lookahead was
1/(1 - gamma*lam) ~ 17 steps -- about two turns.  Openings therefore received
essentially no gradient.  Episodes here are finite and bounded, so undiscounted
returns are well defined and correct; gamma=1.0 lets the outcome propagate to
every decision that produced it.

On trainable transitions
------------------------
When the opponent seat is played by a frozen checkpoint from the opponent pool,
its actions were not drawn from the policy being optimised, so the importance
ratio is meaningless for them.  Those transitions carry trainable=False: they
stay in the trajectory (GAE needs an unbroken chain, and their states are still
valid value-function targets) but are excluded from the policy and entropy
terms.  In pure self-play every transition is trainable and this reduces to the
standard update.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim

from .self_play import Episode
from .model import ActorCriticNet
from .state_encoder import STATE_DIM, N_CARD_SLOTS
from .action_space import ACTION_SPACE_SIZE

_ADV_STD_EPSILON = 1e-6  # prevents division by zero in advantage normalisation
_ADV_CLIP_RANGE = 5.0  # clip normalised advantages to +/-5 sigma


@dataclass
class PPOConfig:
    clip_eps: float = 0.2
    entropy_coef: float = 0.01
    value_coef: float = 0.5
    gamma: float = 1.0
    lam: float = 0.97
    n_epochs: int = 4
    # 1024 rather than 256: measured on CPU, four epochs over ~14k transitions
    # cost 7.3s at 256 and 3.7s at 1024 -- same work, half the per-step overhead.
    batch_size: int = 1024
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
    V_opponent(s) ~ -V_current(s).  When the next step belongs to the opponent,
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
    if n == 0:
        raise ValueError("PPO update called with no transitions")

    all_obs = np.empty((n, STATE_DIM), dtype=np.float32)
    all_card_ids = np.empty((n, N_CARD_SLOTS), dtype=np.int64)
    all_masks = np.empty((n, ACTION_SPACE_SIZE), dtype=np.bool_)
    all_actions = np.empty(n, dtype=np.int64)
    all_log_probs_old = np.empty(n, dtype=np.float32)
    all_advantages = np.empty(n, dtype=np.float32)
    all_returns = np.empty(n, dtype=np.float32)
    all_values_old = np.empty(n, dtype=np.float32)
    all_trainable = np.empty(n, dtype=np.bool_)

    ptr = 0
    for ep in episodes:
        ep_n = len(ep.transitions)
        rewards = [t.reward for t in ep.transitions]
        values = [t.value for t in ep.transitions]
        dones = [t.done for t in ep.transitions]
        player_ids = [t.player_id for t in ep.transitions]

        _compute_gae(
            rewards,
            values,
            dones,
            player_ids,
            config.gamma,
            config.lam,
            all_advantages[ptr : ptr + ep_n],
            all_returns[ptr : ptr + ep_n],
            ep.terminal_value,
            ep.terminal_player_id,
        )

        for i, t in enumerate(ep.transitions):
            all_obs[ptr + i] = t.obs
            all_card_ids[ptr + i] = t.card_ids
            all_masks[ptr + i] = t.legal_mask
            all_actions[ptr + i] = t.action
            all_log_probs_old[ptr + i] = t.log_prob
            all_values_old[ptr + i] = t.value
            all_trainable[ptr + i] = t.trainable
        ptr += ep_n

    n_trainable = int(all_trainable.sum())
    if n_trainable == 0:
        raise ValueError(
            "PPO update: no trainable transitions in this batch -- every episode was "
            "played entirely by pool opponents. Check the opponent-pool sampling rate."
        )

    # Normalise advantages over the transitions the policy loss will actually
    # use.  Including frozen-opponent transitions here would shift the mean by
    # data that never contributes a policy gradient.
    adv_arr = all_advantages  # already float32
    trainable_adv = adv_arr[all_trainable]
    adv_arr -= trainable_adv.mean()
    adv_arr /= trainable_adv.std() + _ADV_STD_EPSILON
    adv_clip_hits = int(
        (((adv_arr > _ADV_CLIP_RANGE) | (adv_arr < -_ADV_CLIP_RANGE)) & all_trainable).sum()
    )
    np.clip(adv_arr, -_ADV_CLIP_RANGE, _ADV_CLIP_RANGE, out=adv_arr)

    # Single-copy transfer to device.
    obs_t = torch.from_numpy(all_obs).to(device, non_blocking=True)
    card_ids_t = torch.from_numpy(all_card_ids).to(device, non_blocking=True)
    masks_t = torch.from_numpy(all_masks).to(device, non_blocking=True)
    actions_t = torch.from_numpy(all_actions).to(device, non_blocking=True)
    log_probs_old_t = torch.from_numpy(all_log_probs_old).to(device, non_blocking=True)
    advantages_t = torch.from_numpy(adv_arr).to(device, non_blocking=True)
    returns_t = torch.from_numpy(all_returns).to(device, non_blocking=True)
    values_old_t = torch.from_numpy(all_values_old).to(device, non_blocking=True)
    trainable_t = torch.from_numpy(all_trainable).to(device, non_blocking=True)

    # Precompute the inverted legal mask once -- it's referenced every minibatch.
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
            keep = trainable_t[idx]
            n_keep = keep.sum()
            if n_keep == 0:
                # Value-only minibatches are possible but rare; skipping keeps
                # the averaged log lines interpretable.
                continue
            weight = keep.float()
            denom = weight.sum()

            logits, values = model(obs_t[idx], card_ids_t[idx])
            logits_masked = logits.masked_fill(inv_masks_t[idx], float("-inf"))
            dist = torch.distributions.Categorical(logits=logits_masked)

            log_probs = dist.log_prob(actions_t[idx])
            entropy = (dist.entropy() * weight).sum() / denom

            ratio = torch.exp(log_probs - log_probs_old_t[idx])
            adv = advantages_t[idx]

            per_sample_policy = -torch.min(
                ratio * adv,
                torch.clamp(ratio, 1 - config.clip_eps, 1 + config.clip_eps) * adv,
            )
            policy_loss = (per_sample_policy * weight).sum() / denom

            # Clipped value loss: prevents value function from moving too far from
            # the rollout estimate, mirroring the policy clip for stability.
            # Applied to every transition -- opponent-played states are still
            # valid samples of the value function.
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
            kl = ((log_probs_old_t[idx] - log_probs) * weight).sum() / denom

            loss = policy_loss + config.value_coef * value_loss - config.entropy_coef * entropy

            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            grad_norm = float(
                nn.utils.clip_grad_norm_(model.parameters(), max_norm=config.max_grad_norm)
            )
            optimizer.step()

            total_policy_loss += policy_loss.detach()
            total_value_loss += value_loss.detach()
            total_entropy += entropy.detach()
            total_kl += kl.detach()
            total_grad_norm += grad_norm
            n_updates += 1

    if n_updates == 0:
        raise ValueError("PPO update completed no minibatches")

    # Single GPU->CPU sync after all minibatches.
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
        "adv_clip_frac": adv_clip_hits / max(n_trainable, 1),
        "trainable_frac": n_trainable / n,
    }
