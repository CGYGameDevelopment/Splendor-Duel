"""
SplendorDuelEnv: gymnasium.Env wrapping the ai-game-sim HTTP server.

Observation space: Box(float32, shape=(STATE_DIM,))  # currently 859
Action space:      Discrete(688)

Each step's info dict contains:
  legal_mask: np.ndarray[688, bool]  — True at each legal action index
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
    build_legal_index_map_and_mask,
)


class SplendorDuelEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(
        self,
        sim_url: str = "http://127.0.0.1:3002",
        illegal_action_penalty: float = -1.0,
    ):
        super().__init__()
        self.client = SimClient(base_url=sim_url)
        self._illegal_action_penalty = illegal_action_penalty
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
            # Illegal action selected — return current obs with configurable penalty
            obs = encode(self._state)
            return obs, self._illegal_action_penalty, False, False, self._make_info()

        try:
            result = self.client.step(self._session_id, concrete)
        except Exception as exc:
            raise RuntimeError(
                f"SimClient.step failed (session={self._session_id!r}, "
                f"action_idx={action}, action={concrete!r}): {exc}"
            ) from exc
        self._state = result["state"]
        self._legal_moves = result["legalMoves"]
        self._update_legal(self._legal_moves)

        done: bool = result["done"]
        winner: int | None = result["winner"]
        self._winner = winner

        reward = 0.0
        if done and winner is not None:
            # The player who just moved receives +1; the other player receives -1.
            # On game_over the engine leaves currentPlayer equal to the winner,
            # but we rely on `winner` directly so a future engine change can't
            # silently flip reward attribution.
            current_player: int = self._state.get("currentPlayer", 0)
            if current_player != winner:
                import logging as _logging
                _logging.getLogger(__name__).warning(
                    "env.step: currentPlayer=%s != winner=%s on game_over; "
                    "attributing reward to winner regardless.",
                    current_player, winner,
                )
            reward = 1.0

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
        self._legal_index_map, self._legal_mask = build_legal_index_map_and_mask(legal_moves)
        if legal_moves and not self._legal_mask.any():
            raise RuntimeError(
                f"_update_legal: {len(legal_moves)} legal moves returned by server but none "
                f"mapped to canonical indices — action_space coverage gap.\n"
                f"  First unmapped move: {legal_moves[0]}"
            )

    def _make_info(self) -> dict:
        return {
            "legal_mask": self._legal_mask,
            "state": self._state,
            "legal_moves": self._legal_moves,
            "winner": self._winner,
        }
