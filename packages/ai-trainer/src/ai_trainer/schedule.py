"""
Learning-rate and entropy schedules, keyed to the run's global iteration.

Both schedules used to be keyed to the position *within one invocation* of the
trainer.  `--resume` therefore restarted them: the entropy coefficient jumped
back to its initial value, and the LR decayed again from wherever the previous
run had left it over a fresh `--iterations` span.  A resumed run behaved like a
new run with a warm start, not a continuation.

Keying both to the global iteration against a fixed horizon, and saving that
horizon in the checkpoint, makes a run split across several invocations follow
the same curve as one uninterrupted run.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

# The LR never decays below this fraction of its base value.
LR_FLOOR_FRAC = 0.05


@dataclass(frozen=True)
class Schedule:
    """The parameters of a run's schedules; persisted in every checkpoint."""

    horizon: int  # iteration at which both schedules reach their final values
    base_lr: float
    lr_decay: bool
    entropy_coef: float
    entropy_coef_final: float

    def progress(self, iteration: int) -> float:
        """Fraction of the horizon completed before `iteration` (1-based), in [0, 1]."""
        return min(max((iteration - 1) / max(self.horizon, 1), 0.0), 1.0)

    def lr(self, iteration: int) -> float:
        if not self.lr_decay:
            return self.base_lr
        return self.base_lr * max(1.0 - self.progress(iteration), LR_FLOOR_FRAC)

    def entropy(self, iteration: int) -> float:
        frac = self.progress(iteration)
        return self.entropy_coef + (self.entropy_coef_final - self.entropy_coef) * frac

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> Schedule:
        return cls(**{name: data[name] for name in cls.__dataclass_fields__})
