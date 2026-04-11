"""Random agent: samples uniformly from the legal mask."""

from __future__ import annotations

import numpy as np


class RandomAgent:
    """Selects a random legal action each step."""

    def __init__(self, rng: np.random.Generator | None = None) -> None:
        self.rng = rng or np.random.default_rng()

    def act(self, legal_mask: np.ndarray) -> int:
        """Return a random legal action index."""
        legal_indices = np.where(legal_mask)[0]
        if len(legal_indices) == 0:
            raise ValueError("No legal actions available")
        return int(self.rng.choice(legal_indices))
