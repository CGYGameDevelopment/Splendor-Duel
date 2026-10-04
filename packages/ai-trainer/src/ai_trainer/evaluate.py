"""
Evaluate the trained model against baselines.

Two things differ from the earlier revision:

* The model plays **greedily** (argmax over legal actions).  It used to sample,
  which measured a deliberately randomised version of the policy -- and since
  best.pt selection keyed off these numbers, the recorded win rates were of a
  weaker player than the one being saved.
* Games are run through a VecSplendorDuelEnv.  A 100-game evaluation is ~35,000
  engine calls; batching turns that into ~350 round trips.
"""

from __future__ import annotations

import logging
from typing import Protocol

import numpy as np
import torch

from .env import VecSplendorDuelEnv
from .model import ActorCriticNet
from .random_agent import GreedyPurchaseAgent, RandomAgent

MAX_EVAL_STEPS = 2_000
_FIRST_PLAYER_BIAS_THRESHOLD = 0.1


# -- Policies ------------------------------------------------------------------


class Policy(Protocol):
    """Chooses one action index for each of the given env slots."""

    def act(self, env: VecSplendorDuelEnv, slots: list[int]) -> list[int]: ...


class ModelPolicy:
    """
    A network driving one seat.

    greedy=True picks the highest-logit legal action.  That is what a player
    should do at evaluation and deployment time; sampling is for exploration
    during rollouts, not for measuring or showing strength.  `temperature`
    applies only when greedy is False.
    """

    def __init__(
        self,
        model: ActorCriticNet,
        device: torch.device | None = None,
        greedy: bool = True,
        temperature: float = 1.0,
    ) -> None:
        self.model = model
        self.device = device or next(model.parameters()).device
        self.greedy = greedy
        self.temperature = temperature
        model.eval()

    @torch.inference_mode()
    def act(self, env: VecSplendorDuelEnv, slots: list[int]) -> list[int]:
        obs = torch.from_numpy(env.obs[slots]).to(self.device)
        masks = torch.from_numpy(env.masks[slots]).to(self.device)
        card_ids = torch.from_numpy(env.card_ids[slots]).to(self.device)
        logits, _ = self.model(obs, card_ids)
        logits = logits.masked_fill(~masks, float("-inf"))
        if self.greedy:
            return logits.argmax(dim=-1).cpu().tolist()
        dist = torch.distributions.Categorical(logits=logits / max(self.temperature, 1e-6))
        return dist.sample().cpu().tolist()


class BaselinePolicy:
    """Wraps a per-state baseline agent (RandomAgent, GreedyPurchaseAgent)."""

    def __init__(self, act_fn) -> None:
        self._act = act_fn

    def act(self, env: VecSplendorDuelEnv, slots: list[int]) -> list[int]:
        return [self._act(env, i) for i in slots]


def random_policy(seed: int | None = None) -> BaselinePolicy:
    agent = RandomAgent(rng=np.random.default_rng(seed))
    return BaselinePolicy(lambda env, i: agent.act(env.masks[i]))


def greedy_purchase_policy(seed: int | None = None) -> BaselinePolicy:
    agent = GreedyPurchaseAgent(rng=np.random.default_rng(seed))
    return BaselinePolicy(
        lambda env, i: agent.act(env.slots[i].legal_moves, env.masks[i], env.slots[i].state)
    )


# -- Match runner --------------------------------------------------------------


def _play_matches(
    env: VecSplendorDuelEnv,
    n_games: int,
    policy_a: Policy,
    policy_b: Policy,
    max_steps: int = MAX_EVAL_STEPS,
) -> tuple[int, int, int, int, int]:
    """
    Play n_games between policy_a and policy_b, alternating seats.

    Returns (wins_a, wins_a_as_p0, games_as_p0, wins_a_as_p1, games_as_p1).
    Games that hit max_steps count as neither side's win.
    """
    assert n_games > 0
    env.reset_all()
    n_slots = env.n_envs

    # Seat that policy_a occupies in the game currently held by each slot.
    a_seat: list[int] = []
    steps = [0] * n_slots
    dealt = 0
    for _ in range(n_slots):
        a_seat.append(dealt % 2)
        dealt += 1

    wins_a = wins_p0 = wins_p1 = games_p0 = games_p1 = 0
    completed = 0

    while completed < n_games:
        active = [i for i in env.active_slots() if steps[i] < max_steps]
        if not active:
            break

        # Split by which policy is on turn, so each side acts on a full batch.
        slots_a = [i for i in active if env.slots[i].current_player == a_seat[i]]
        slots_b = [i for i in active if env.slots[i].current_player != a_seat[i]]

        chosen: dict[int, int] = {}
        if slots_a:
            chosen.update(dict(zip(slots_a, policy_a.act(env, slots_a))))
        if slots_b:
            chosen.update(dict(zip(slots_b, policy_b.act(env, slots_b))))

        ordered = [chosen[i] for i in active]
        results = env.step(active, ordered)

        to_reset: list[int] = []
        for slot in active:
            steps[slot] += 1
            result = results[slot]
            timed_out = not result.done and steps[slot] >= max_steps
            if not (result.done or timed_out):
                continue

            seat = a_seat[slot]
            if seat == 0:
                games_p0 += 1
            else:
                games_p1 += 1
            if result.done and result.winner == seat:
                wins_a += 1
                if seat == 0:
                    wins_p0 += 1
                else:
                    wins_p1 += 1

            completed += 1
            if completed >= n_games:
                break
            if dealt < n_games:
                a_seat[slot] = dealt % 2
                dealt += 1
                steps[slot] = 0
                to_reset.append(slot)

        if completed >= n_games:
            break
        if to_reset:
            env.reset_slots(to_reset)

    return wins_a, wins_p0, games_p0, wins_p1, games_p1


def _warn_on_seat_bias(
    label: str, wins_p0: int, games_p0: int, wins_p1: int, games_p1: int
) -> None:
    wr_p0 = wins_p0 / games_p0 if games_p0 else 0.0
    wr_p1 = wins_p1 / games_p1 if games_p1 else 0.0
    bias = abs(wr_p0 - wr_p1)
    if games_p0 and games_p1 and bias > _FIRST_PLAYER_BIAS_THRESHOLD:
        logging.getLogger(__name__).warning(
            "%s: first-player bias detected -- win rate as P0=%.1f%%, as P1=%.1f%% (gap %.1f%%)",
            label,
            wr_p0 * 100,
            wr_p1 * 100,
            bias * 100,
        )


# -- Public evaluation functions -----------------------------------------------


def win_rate_vs_greedy(
    model: ActorCriticNet,
    env: VecSplendorDuelEnv,
    n_games: int = 100,
    device: torch.device | None = None,
    seed: int | None = None,
) -> float:
    """
    Play n_games against the greedy-purchase agent and return the model's win rate.

    The model plays greedily and alternates seats to cancel first-player bias.
    """
    wins, w0, g0, w1, g1 = _play_matches(
        env, n_games, ModelPolicy(model, device, greedy=True), greedy_purchase_policy(seed)
    )
    _warn_on_seat_bias("win_rate_vs_greedy", w0, g0, w1, g1)
    return wins / n_games


def win_rate_vs_random(
    model: ActorCriticNet,
    env: VecSplendorDuelEnv,
    n_games: int = 50,
    device: torch.device | None = None,
    seed: int = 0,
) -> float:
    """
    Play n_games against a random agent and return the model's win rate.

    A fixed RNG seed keeps results comparable across checkpoints.
    """
    wins, w0, g0, w1, g1 = _play_matches(
        env, n_games, ModelPolicy(model, device, greedy=True), random_policy(seed)
    )
    _warn_on_seat_bias("win_rate_vs_random", w0, g0, w1, g1)
    return wins / n_games


def win_rate_vs_model(
    model_a: ActorCriticNet,
    model_b: ActorCriticNet,
    env: VecSplendorDuelEnv,
    n_games: int = 50,
    device: torch.device | None = None,
) -> float:
    """Play n_games between model_a and model_b; returns model_a's win rate."""
    wins, _, _, _, _ = _play_matches(
        env,
        n_games,
        ModelPolicy(model_a, device, greedy=True),
        ModelPolicy(model_b, device, greedy=True),
    )
    return wins / n_games
