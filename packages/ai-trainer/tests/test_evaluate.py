"""Paired, seeded evaluation: every deal is played from both seats."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

import pytest

pytest.importorskip("torch")

from ai_trainer.env import VecStepResult
from ai_trainer.evaluate import _play_matches, deal_seeds


@dataclass
class _Slot:
    seed: int | None = None
    done: bool = False
    current_player: int = 0


class OneMoveEnv:
    """
    A game that lasts one move and is decided by the deal: an even seed is won
    by seat 0, an odd one by seat 1.  Whoever plays, each deal has one winner.
    """

    def __init__(self, n_envs: int) -> None:
        self.n_envs = n_envs
        self.slots = [_Slot() for _ in range(n_envs)]
        self.dealt: list[int | None] = []

    def reset_all(self, seeds=None):
        self.reset_slots(list(range(self.n_envs)), seeds)

    def reset_slots(self, slots, seeds=None):
        for pos, i in enumerate(slots):
            seed = seeds[pos] if seeds else None
            self.slots[i] = _Slot(seed=seed)
            self.dealt.append(seed)

    def active_slots(self):
        return [i for i, s in enumerate(self.slots) if not s.done]

    def step(self, slots, actions):
        out = {}
        for i in slots:
            slot = self.slots[i]
            slot.done = True
            winner = (slot.seed or 0) % 2
            out[i] = VecStepResult(
                actor=0, reward=0.0, done=True, winner=winner, win_condition=None
            )
        return out


class AnyMove:
    def act(self, env, slots):
        return [0 for _ in slots]


class TestPlayMatches:
    def test_each_deal_is_played_once_from_each_seat(self):
        # Arrange
        env = OneMoveEnv(n_envs=3)
        # Act
        wins, _, g0, _, g1 = _play_matches(env, 10, AnyMove(), AnyMove(), seed=7)
        # Assert: whatever the deals, the deal decides one game of each pair
        # for each side, so the two players split the match exactly.
        assert wins == 5
        assert g0 == g1 == 5
        counts = Counter(s for s in env.dealt if s is not None)
        assert sorted(counts) == sorted(deal_seeds(7, 10))
        assert set(counts.values()) == {2}

    def test_the_same_seed_deals_the_same_games(self):
        assert deal_seeds(3, 20) == deal_seeds(3, 20)
        assert deal_seeds(3, 20) != deal_seeds(4, 20)

    def test_idle_slots_do_not_count_when_there_are_more_slots_than_games(self):
        env = OneMoveEnv(n_envs=8)
        wins, _, g0, _, g1 = _play_matches(env, 4, AnyMove(), AnyMove(), seed=1)
        assert g0 + g1 == 4
        assert wins == 2
