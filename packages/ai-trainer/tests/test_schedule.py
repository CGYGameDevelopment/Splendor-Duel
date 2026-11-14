from __future__ import annotations

import pytest

from ai_trainer.schedule import LR_FLOOR_FRAC, Schedule


def make(**overrides) -> Schedule:
    params = {
        "horizon": 100,
        "base_lr": 1e-3,
        "lr_decay": True,
        "entropy_coef": 0.01,
        "entropy_coef_final": 0.001,
    }
    params.update(overrides)
    return Schedule(**params)


class TestSchedule:
    def test_starts_at_the_base_values(self):
        s = make()
        assert s.lr(1) == pytest.approx(1e-3)
        assert s.entropy(1) == pytest.approx(0.01)

    def test_reaches_the_final_values_at_the_horizon_and_stays_there(self):
        s = make()
        assert s.entropy(101) == pytest.approx(0.001)
        assert s.lr(101) == pytest.approx(1e-3 * LR_FLOOR_FRAC)
        assert s.lr(500) == s.lr(101)
        assert s.entropy(500) == s.entropy(101)

    def test_is_a_function_of_the_global_iteration_alone(self):
        # Arrange: a run resumed at iteration 51 rebuilds its schedule from the
        # checkpoint; it must continue the same curve, not restart it.
        original = make()
        resumed = Schedule.from_dict(original.to_dict())
        # Assert
        for it in (51, 60, 99):
            assert resumed.lr(it) == original.lr(it)
            assert resumed.entropy(it) == original.entropy(it)
        assert resumed.entropy(51) < original.entropy(1)

    def test_constant_lr_when_decay_is_off(self):
        s = make(lr_decay=False)
        assert s.lr(1) == s.lr(80) == pytest.approx(1e-3)
