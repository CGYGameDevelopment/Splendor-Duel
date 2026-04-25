"""
Evaluate the trained model against baselines.
"""

from __future__ import annotations

import logging
from typing import Callable

import numpy as np
import torch

from .env import SplendorDuelEnv
from .model import ActorCriticNet
from .random_agent import GreedyPurchaseAgent, RandomAgent
from .state_encoder import STATE_DIM
from .action_space import ACTION_SPACE_SIZE

MAX_EVAL_STEPS = 2_000
_FIRST_PLAYER_BIAS_THRESHOLD = 0.1


# ── Shared game-loop helper ───────────────────────────────────────────────────

ActionFn = Callable[[np.ndarray, np.ndarray, dict], int]


def _run_game(
    env: SplendorDuelEnv,
    player_fns: tuple[ActionFn, ActionFn],
) -> int | None:
    """
    Play one game to completion and return the winner index (or None on timeout).

    player_fns[i] is called when it is player i's turn.
    Signature: (obs_np, legal_mask, info) -> action_int
    """
    obs_np, info = env.reset()
    for _ in range(MAX_EVAL_STEPS):
        p: int = info["state"].get("currentPlayer", 0)
        action = player_fns[p](obs_np, info["legal_mask"], info)
        obs_np, _, done, _, info = env.step(action)
        if done:
            break
    return info["winner"]


def _model_action_fn(
    model: ActorCriticNet,
    obs_buf: torch.Tensor,
    mask_buf: torch.Tensor,
) -> ActionFn:
    """Return a closure that runs greedy model inference."""
    def fn(obs_np: np.ndarray, legal_mask: np.ndarray, info: dict) -> int:
        obs_buf.copy_(torch.from_numpy(obs_np).unsqueeze(0), non_blocking=True)
        mask_buf.copy_(torch.from_numpy(legal_mask).unsqueeze(0), non_blocking=True)
        dist = model.masked_policy(obs_buf, mask_buf)
        return int(dist.sample().item())
    return fn


# ── Public evaluation functions ───────────────────────────────────────────────

@torch.inference_mode()
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
    """
    assert n_games > 0
    if device is None:
        device = next(model.parameters()).device
    model.eval()

    opponent = GreedyPurchaseAgent()
    obs_buf = torch.empty((1, STATE_DIM), dtype=torch.float32, device=device)
    mask_buf = torch.empty((1, ACTION_SPACE_SIZE), dtype=torch.bool, device=device)
    model_fn = _model_action_fn(model, obs_buf, mask_buf)

    def opp_fn(obs_np: np.ndarray, legal_mask: np.ndarray, info: dict) -> int:
        return opponent.act(info["legal_moves"], legal_mask, info["state"])

    wins = wins_as_p0 = wins_as_p1 = 0
    for game_idx in range(n_games):
        model_player = game_idx % 2
        fns = (model_fn, opp_fn) if model_player == 0 else (opp_fn, model_fn)
        winner = _run_game(env, fns)
        if winner == model_player:
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


@torch.inference_mode()
def win_rate_vs_random(
    model: ActorCriticNet,
    env: SplendorDuelEnv,
    n_games: int = 50,
    device: torch.device | None = None,
    seed: int = 0,
) -> float:
    """
    Play n_games against a random agent and return the model's win rate.

    A fixed RNG seed is used so results are comparable across checkpoints.
    The model alternates sides to eliminate first-player bias.
    """
    assert n_games > 0
    if device is None:
        device = next(model.parameters()).device
    model.eval()

    opponent = RandomAgent(rng=np.random.default_rng(seed))
    obs_buf = torch.empty((1, STATE_DIM), dtype=torch.float32, device=device)
    mask_buf = torch.empty((1, ACTION_SPACE_SIZE), dtype=torch.bool, device=device)
    model_fn = _model_action_fn(model, obs_buf, mask_buf)

    def opp_fn(obs_np: np.ndarray, legal_mask: np.ndarray, info: dict) -> int:
        return opponent.act(legal_mask)

    wins = wins_as_p0 = wins_as_p1 = 0
    for game_idx in range(n_games):
        model_player = game_idx % 2
        fns = (model_fn, opp_fn) if model_player == 0 else (opp_fn, model_fn)
        if _run_game(env, fns) == model_player:
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
            "win_rate_vs_random: first-player bias detected — "
            "win rate as P0=%.1f%%, as P1=%.1f%% (gap %.1f%%)",
            wr_p0 * 100, wr_p1 * 100, bias * 100,
        )
    return wins / n_games


@torch.inference_mode()
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
    """
    assert n_games > 0
    if device is None:
        device = next(model_a.parameters()).device
    model_a.eval()
    model_b.eval()

    # Each model gets its own inference buffers to avoid aliasing.
    obs_buf_a = torch.empty((1, STATE_DIM), dtype=torch.float32, device=device)
    mask_buf_a = torch.empty((1, ACTION_SPACE_SIZE), dtype=torch.bool, device=device)
    obs_buf_b = torch.empty((1, STATE_DIM), dtype=torch.float32, device=device)
    mask_buf_b = torch.empty((1, ACTION_SPACE_SIZE), dtype=torch.bool, device=device)
    fn_a = _model_action_fn(model_a, obs_buf_a, mask_buf_a)
    fn_b = _model_action_fn(model_b, obs_buf_b, mask_buf_b)

    wins = 0
    for game_idx in range(n_games):
        a_player = game_idx % 2
        fns = (fn_a, fn_b) if a_player == 0 else (fn_b, fn_a)
        if _run_game(env, fns) == a_player:
            wins += 1
    return wins / n_games
