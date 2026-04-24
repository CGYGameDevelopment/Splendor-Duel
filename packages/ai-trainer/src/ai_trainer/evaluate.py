"""
Evaluate the trained model against baselines.
"""

from __future__ import annotations

import logging
import numpy as np
import torch

from .env import SplendorDuelEnv
from .model import ActorCriticNet
from .random_agent import GreedyPurchaseAgent

MAX_EVAL_STEPS = 2_000
_FIRST_PLAYER_BIAS_THRESHOLD = 0.1  # warn if P0 vs P1 win-rate gap exceeds 10%


@torch.no_grad()
def win_rate_vs_greedy(
    model: ActorCriticNet,
    env: SplendorDuelEnv,
    n_games: int = 100,
    device: torch.device | None = None,
) -> float:
    """
    Play n_games against a greedy-purchase agent and return the model's win rate.

    The opponent always buys the highest-level pyramid card it can afford;
    otherwise it picks a random legal action.

    To eliminate first-player bias the model alternates sides each game.
    MAX_EVAL_STEPS caps each game to guard against infinite loops.
    """
    assert n_games > 0, "n_games must be positive"
    if device is None:
        device = next(model.parameters()).device

    model.eval()
    opponent = GreedyPurchaseAgent()
    wins = 0
    wins_as_p0 = 0
    wins_as_p1 = 0

    for game_idx in range(n_games):
        model_player = game_idx % 2  # alternate sides each game

        obs_np, info = env.reset()
        done = False
        step = 0

        while not done and step < MAX_EVAL_STEPS:
            state = info["state"]
            current_player: int = state.get("currentPlayer", 0)
            legal_mask: np.ndarray = info["legal_mask"]

            if current_player == model_player:
                obs_t = torch.tensor(obs_np, dtype=torch.float32, device=device).unsqueeze(0)
                mask_t = torch.tensor(legal_mask, dtype=torch.bool, device=device).unsqueeze(0)
                dist = model.masked_policy(obs_t, mask_t)
                action = int(dist.sample().item())
            else:
                action = opponent.act(info["legal_moves"], legal_mask, state)

            obs_np, _, done, _, info = env.step(action)
            step += 1

        won = info["winner"] == model_player
        if won:
            wins += 1
            if model_player == 0:
                wins_as_p0 += 1
            else:
                wins_as_p1 += 1

    games_as_p0 = n_games // 2 + (n_games % 2)
    games_as_p1 = n_games // 2
    wr_p0 = wins_as_p0 / games_as_p0 if games_as_p0 else 0.0
    wr_p1 = wins_as_p1 / games_as_p1 if games_as_p1 else 0.0
    bias = abs(wr_p0 - wr_p1)
    if bias > _FIRST_PLAYER_BIAS_THRESHOLD:
        logging.getLogger(__name__).warning(
            "win_rate_vs_greedy: first-player bias detected — "
            "win rate as P0=%.1f%%, as P1=%.1f%% (gap %.1f%%)",
            wr_p0 * 100, wr_p1 * 100, bias * 100,
        )

    return wins / n_games


@torch.no_grad()
def win_rate_vs_model(
    model_a: ActorCriticNet,
    model_b: ActorCriticNet,
    env: SplendorDuelEnv,
    n_games: int = 50,
    device: torch.device | None = None,
) -> float:
    """
    Play n_games between model_a and model_b and return model_a's win rate.

    Sides alternate each game to eliminate first-player bias.
    MAX_EVAL_STEPS caps each game to guard against infinite loops.
    """
    assert n_games > 0, "n_games must be positive"
    if device is None:
        device = next(model_a.parameters()).device

    model_a.eval()
    model_b.eval()
    wins = 0

    for game_idx in range(n_games):
        a_player = game_idx % 2  # which seat model_a occupies this game

        obs_np, info = env.reset()
        done = False
        step = 0

        while not done and step < MAX_EVAL_STEPS:
            state = info["state"]
            current_player: int = state.get("currentPlayer", 0)
            legal_mask: np.ndarray = info["legal_mask"]

            model = model_a if current_player == a_player else model_b
            obs_t = torch.tensor(obs_np, dtype=torch.float32, device=device).unsqueeze(0)
            mask_t = torch.tensor(legal_mask, dtype=torch.bool, device=device).unsqueeze(0)
            dist = model.masked_policy(obs_t, mask_t)
            action = int(dist.sample().item())

            obs_np, _, done, _, info = env.step(action)
            step += 1

        if info["winner"] == a_player:
            wins += 1

    return wins / n_games
