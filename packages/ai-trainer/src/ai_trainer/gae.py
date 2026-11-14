"""
Generalised Advantage Estimation for a two-player, zero-sum, alternating game.

Kept free of torch so it can be tested -- and reasoned about -- on its own: the
perspective flips below are the part of the PPO update most likely to be
silently wrong, and a sign error there does not crash, it trains the policy to
help the opponent.
"""

from __future__ import annotations

import numpy as np


def compute_gae(
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
