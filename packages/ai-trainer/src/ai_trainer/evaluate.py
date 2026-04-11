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
    Play n_games against a random agent and return the model's win rate.

    To eliminate first-player bias the model alternates sides: it plays as
    player 0 for the first half of the games and player 1 for the second half.
    """
    if device is None:
        device = next(model.parameters()).device

    model.eval()
    random_agent = RandomAgent()
    wins = 0

    for game_idx in range(n_games):
        model_player = game_idx % 2  # alternate sides each game

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

        if info["winner"] == model_player:
            wins += 1

    return wins / n_games
