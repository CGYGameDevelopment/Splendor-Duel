"""
Evaluate the trained model against baselines.

Two things differ from the earlier revision:

* The model plays **greedily** (argmax over legal actions).  It used to sample,
  which measured a deliberately randomised version of the policy -- and since
  best.pt selection keyed off these numbers, the recorded win rates were of a
  weaker player than the one being saved.
* Games are run through a VecSplendorDuelEnv.  A 100-game evaluation is ~35,000
  engine calls; batching turns that into ~350 round trips.

Seeded, paired deals
--------------------
With fresh random deals every time, two checkpoints were measured on different
games, and a 200-game win rate carries about +/-3.5 points of sampling noise --
enough to crown a "best" model on luck.  Evaluations now take a seed: game k
is dealt from `deal_seeds(seed, n)[k // 2]` with the seats swapped between the
two games of each pair.  Every checkpoint then plays the same deals, from both
seats, which removes the deal and the seat from the comparison and leaves only
the difference between the players.
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


def deal_seeds(seed: int, n_games: int) -> list[int]:
    """The deal seeds for an n_games evaluation: one per pair of games."""
    rng = np.random.default_rng(seed)
    return [int(x) for x in rng.integers(0, 2**31 - 1, size=(n_games + 1) // 2)]


def _play_matches(
    env: VecSplendorDuelEnv,
    n_games: int,
    policy_a: Policy,
    policy_b: Policy,
    max_steps: int = MAX_EVAL_STEPS,
    seed: int | None = None,
) -> tuple[int, int, int, int, int]:
    """
    Play n_games between policy_a and policy_b.

    Game k puts policy_a in seat k % 2.  With `seed`, games 2j and 2j+1 share
    one deal, so each deal is played from both seats; without it every game is
    dealt at random.

    Returns (wins_a, wins_a_as_p0, games_as_p0, wins_a_as_p1, games_as_p1).
    Games that hit max_steps count as neither side's win.
    """
    assert n_games > 0
    seeds = deal_seeds(seed, n_games) if seed is not None else None
    schedule: list[tuple[int | None, int]] = [
        (seeds[k // 2] if seeds else None, k % 2) for k in range(n_games)
    ]

    n_slots = env.n_envs
    # Index into `schedule` of the game each slot is playing; None = idle.
    slot_game: list[int | None] = [k if k < n_games else None for k in range(n_slots)]
    env.reset_all(seeds=[schedule[k][0] if k is not None else None for k in slot_game])
    next_game = min(n_slots, n_games)
    steps = [0] * n_slots

    wins_a = wins_p0 = wins_p1 = games_p0 = games_p1 = 0
    completed = 0

    def seat_of(slot: int) -> int:
        game = slot_game[slot]
        assert game is not None
        return schedule[game][1]

    while completed < n_games:
        active = [i for i in env.active_slots() if slot_game[i] is not None]
        if not active:
            break

        # Split by which policy is on turn, so each side acts on a full batch.
        slots_a = [i for i in active if env.slots[i].current_player == seat_of(i)]
        slots_b = [i for i in active if env.slots[i].current_player != seat_of(i)]

        chosen: dict[int, int] = {}
        if slots_a:
            chosen.update(dict(zip(slots_a, policy_a.act(env, slots_a))))
        if slots_b:
            chosen.update(dict(zip(slots_b, policy_b.act(env, slots_b))))

        results = env.step(active, [chosen[i] for i in active])

        to_reset: list[int] = []
        reset_seeds: list[int | None] = []
        for slot in active:
            steps[slot] += 1
            result = results[slot]
            timed_out = not result.done and steps[slot] >= max_steps
            if not (result.done or timed_out):
                continue

            seat = seat_of(slot)
            won = result.done and result.winner == seat
            if seat == 0:
                games_p0 += 1
                wins_p0 += int(won)
            else:
                games_p1 += 1
                wins_p1 += int(won)
            wins_a += int(won)
            completed += 1

            if next_game < n_games:
                slot_game[slot] = next_game
                steps[slot] = 0
                to_reset.append(slot)
                reset_seeds.append(schedule[next_game][0])
                next_game += 1
            else:
                slot_game[slot] = None

        if to_reset:
            env.reset_slots(to_reset, seeds=reset_seeds)

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

    The model plays greedily.  With `seed`, the deals and the baseline's
    tie-breaking are fixed, so the result is comparable across checkpoints.
    """
    wins, w0, g0, w1, g1 = _play_matches(
        env,
        n_games,
        ModelPolicy(model, device, greedy=True),
        greedy_purchase_policy(seed),
        seed=seed,
    )
    _warn_on_seat_bias("win_rate_vs_greedy", w0, g0, w1, g1)
    return wins / n_games


def win_rate_vs_random(
    model: ActorCriticNet,
    env: VecSplendorDuelEnv,
    n_games: int = 50,
    device: torch.device | None = None,
    seed: int | None = 0,
) -> float:
    """Play n_games against a random agent and return the model's win rate."""
    wins, w0, g0, w1, g1 = _play_matches(
        env, n_games, ModelPolicy(model, device, greedy=True), random_policy(seed), seed=seed
    )
    _warn_on_seat_bias("win_rate_vs_random", w0, g0, w1, g1)
    return wins / n_games


def win_rate_vs_model(
    model_a: ActorCriticNet,
    model_b: ActorCriticNet,
    env: VecSplendorDuelEnv,
    n_games: int = 50,
    device: torch.device | None = None,
    seed: int | None = None,
) -> float:
    """
    Play n_games between model_a and model_b; returns model_a's win rate.

    Both play greedily, so with `seed` the whole match is deterministic and a
    rematch gives the same number.
    """
    wins, _, _, _, _ = _play_matches(
        env,
        n_games,
        ModelPolicy(model_a, device, greedy=True),
        ModelPolicy(model_b, device, greedy=True),
        seed=seed,
    )
    return wins / n_games
