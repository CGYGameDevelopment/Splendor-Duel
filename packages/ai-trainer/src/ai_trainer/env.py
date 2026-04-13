"""
SplendorDuelEnv: gymnasium.Env wrapping the game-sim HTTP server.

Observation space: Box(float32, shape=(858,))
Action space:      Discrete(3677)

Each step's info dict contains:
  legal_mask: np.ndarray[3677, bool]  — True at each legal action index
  state:      dict                   — raw GameState from the server
  legal_moves: list[dict]            — raw legal moves from the server
  winner:     int | None             — winning player index, or None if game not over
"""

from __future__ import annotations

import numpy as np
import gymnasium as gym
from gymnasium import spaces

from .sim_client import SimClient
from .state_encoder import encode, STATE_DIM
from .action_space import (
    ACTION_SPACE_SIZE,
    build_legal_index_map,
)


class SplendorDuelEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, sim_url: str = "http://127.0.0.1:3002"):
        super().__init__()
        self.client = SimClient(base_url=sim_url)
        self.observation_space = spaces.Box(
            low=0.0, high=1.0, shape=(STATE_DIM,), dtype=np.float32
        )
        self.action_space = spaces.Discrete(ACTION_SPACE_SIZE)

        self._session_id: str | None = None
        self._legal_moves: list[dict] = []
        self._legal_index_map: dict[int, dict] = {}
        self._legal_mask: np.ndarray = np.zeros(ACTION_SPACE_SIZE, dtype=bool)
        self._state: dict = {}
        self._winner: int | None = None

    # ── Core API ──────────────────────────────────────────────────────────────

    def reset(
        self,
        *,
        seed: int | None = None,
        options: dict | None = None,
    ) -> tuple[np.ndarray, dict]:
        super().reset(seed=seed)

        if self._session_id is not None:
            self.client.close_session(self._session_id)

        result = self.client.reset()
        self._session_id = result["sessionId"]
        self._state = result["state"]
        self._legal_moves = result["legalMoves"]
        self._update_legal(self._legal_moves)
        self._winner = None

        obs = encode(self._state)
        info = self._make_info()
        return obs, info

    def step(self, action: int) -> tuple[np.ndarray, float, bool, bool, dict]:
        assert self._session_id is not None, "Call reset() before step()"

        # Map canonical index → concrete action dict
        concrete = self._legal_index_map.get(action)
        if concrete is None:
            # Illegal action selected — return current obs with negative reward
            obs = encode(self._state)
            return obs, -1.0, False, False, self._make_info()

        result = self.client.step(self._session_id, concrete)
        self._state = result["state"]
        self._legal_moves = result["legalMoves"]
        self._update_legal(self._legal_moves)

        done: bool = result["done"]
        winner: int | None = result["winner"]
        self._winner = winner
        current_player: int = self._state.get("currentPlayer", 0)

        reward = 0.0
        if done and winner is not None:
            # Reward from the perspective of the player who just moved.
            # endTurn() does NOT advance currentPlayer on game_over — it stays as
            # state.winner.  So the player who just moved is current_player itself.
            acting_player = current_player
            reward = 1.0 if winner == acting_player else -1.0

        obs = encode(self._state)
        info = self._make_info()
        return obs, reward, done, False, info

    def close(self) -> None:
        if self._session_id is not None:
            self.client.close_session(self._session_id)
            self._session_id = None

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _update_legal(self, legal_moves: list[dict]) -> None:
        """Build index map and mask in one pass over legal_moves."""
        self._legal_index_map = build_legal_index_map(legal_moves)
        mask = np.zeros(ACTION_SPACE_SIZE, dtype=bool)
        for idx in self._legal_index_map:
            mask[idx] = True
        self._legal_mask = mask

    def _make_info(self) -> dict:
        return {
            "legal_mask": self._legal_mask,
            "state": self._state,
            "legal_moves": self._legal_moves,
            "winner": self._winner,
        }
