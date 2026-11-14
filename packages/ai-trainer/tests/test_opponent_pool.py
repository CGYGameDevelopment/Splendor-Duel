from __future__ import annotations

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from ai_trainer.self_play import OpponentPool


def tagged(i: int) -> torch.nn.Module:
    """A stand-in model whose single weight records when it was added."""
    m = torch.nn.Linear(1, 1, bias=False)
    with torch.no_grad():
        m.weight.fill_(float(i))
    return m


def tags(pool: OpponentPool) -> list[int]:
    return sorted(int(s["weight"].item()) for s in pool.state_dicts())


class TestOpponentPool:
    def test_never_exceeds_its_size(self):
        pool = OpponentPool(max_size=8, rng=np.random.default_rng(0))
        for i in range(40):
            pool.add(tagged(i))
        assert len(pool) == 8

    def test_always_keeps_the_newest_half(self):
        pool = OpponentPool(max_size=8, rng=np.random.default_rng(0))
        for i in range(40):
            pool.add(tagged(i))
        assert tags(pool)[-4:] == [36, 37, 38, 39]

    def test_keeps_snapshots_older_than_a_fifo_would(self):
        # Arrange: a FIFO of 8 after 40 additions holds only 32..39.
        pool = OpponentPool(max_size=8, rng=np.random.default_rng(0))
        # Act
        for i in range(40):
            pool.add(tagged(i))
        # Assert
        assert min(tags(pool)) < 32

    def test_a_pool_of_one_keeps_the_latest(self):
        pool = OpponentPool(max_size=1, rng=np.random.default_rng(0))
        for i in range(5):
            pool.add(tagged(i))
        assert tags(pool) == [4]
