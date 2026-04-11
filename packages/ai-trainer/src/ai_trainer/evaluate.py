"""
Evaluate the trained model against the random agent baseline.
"""

from __future__ import annotations

import numpy as np
import torch

from .env import SplendorDuelEnv
from .model import ActorCriticNet
from .random_agent import RandomAgent


@torch.no_grad()
def win_rate_vs_random(
    model: ActorCriticNet,
    env: SplendorDuelEnv,
    n_games: int = 100,
    device: torch.device | None = None,
) -> float:
    """
    Play n_games with the model as player 0 and a random agent as player 1.

    The env's current player perspective always starts at player 0
    (secondPlayerGetsPrivilege=True gives player 1 one privilege to compensate).
    We track which player the model controls across turns using the raw state.

    Returns the fraction of games won by the model.
    """
    if device is None:
        device = next(model.parameters()).device

    model.eval()
    random_agent = RandomAgent()
    model_player = 0  # model always plays as player 0
    wins = 0

    for _ in range(n_games):
        obs_np, info = env.reset()
        done = False

        while not done:
            state = info["state"]
            current_player: int = state.get("currentPlayer", 0)
            legal_mask: np.ndarray = info["legal_mask"]

            if current_player == model_player:
                obs_t = torch.tensor(obs_np, dtype=torch.float32, device=device).unsqueeze(0)
                mask_t = torch.tensor(legal_mask, dtype=torch.bool, device=device).unsqueeze(0)
                dist = model.masked_policy(obs_t, mask_t)
                action = int(dist.sample().item())
            else:
                action = random_agent.act(legal_mask)

            obs_np, _, done, _, info = env.step(action)

        winner = info["state"].get("winner")
        if winner == model_player:
            wins += 1

    return wins / n_games
