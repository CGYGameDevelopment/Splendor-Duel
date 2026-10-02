"""
VecSplendorDuelEnv: N games stepped in lockstep through one HTTP round trip.

Per-action HTTP latency, not engine compute, caps rollout throughput -- it was
measured at 79-88% of collection wall-clock.  Two things follow from that:

* Games are driven in lockstep, so a round costs one request and one batched
  policy forward regardless of how many games are in flight.  Running thin is
  expensive: a forward pass costs 1319 us/row at batch 1 against 41.7 us/row at
  batch 64.
* Responses use the server's compact form, which replaces the undrawn deck
  arrays with counts.  The encoder only ever read the sizes, and the arrays were
  71.5% of every response body.

The compact state is observation-only and must not be handed back to the engine.

Observation is Box(float32, (STATE_DIM,)); actions are Discrete(ACTION_SPACE_SIZE).
Alongside each observation the env exposes `card_ids`, the card id occupying each
visible card slot, which the model's card pointer head needs to route per-card
logits to their action indices.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .action_space import ACTION_SPACE_SIZE, build_legal_index_map_and_mask
from .sim_client import SimClient
from .state_encoder import STATE_DIM, N_CARD_SLOTS, encode, encode_card_ids


def _reward_for_actor(actor: int, done: bool, winner: int | None) -> float:
    """
    Zero-sum terminal reward from the perspective of the player who just moved.

    Attribution is driven by `winner`, never by whoever happened to act last.
    The engine currently sets winner = currentPlayer at the moment the win is
    detected, so the two always agree -- but reading `winner` directly means an
    engine change cannot silently invert the reward signal.
    """
    if not done or winner is None:
        return 0.0
    return 1.0 if winner == actor else -1.0


@dataclass
class _Slot:
    """One in-flight game inside a VecSplendorDuelEnv."""
    session_id: str
    state: dict = field(default_factory=dict)
    legal_moves: list[dict] = field(default_factory=list)
    index_map: dict[int, dict] = field(default_factory=dict)
    done: bool = False
    winner: int | None = None
    win_condition: str | None = None

    @property
    def current_player(self) -> int:
        return self.state.get("currentPlayer", 0)


@dataclass
class VecStepResult:
    """Outcome of one slot's step, from the perspective of the player who moved."""
    actor: int
    reward: float
    done: bool
    winner: int | None
    win_condition: str | None


class VecSplendorDuelEnv:
    """
    N independent games driven in lockstep, one HTTP round trip per step.

    Slots are never implicitly recycled: when a game finishes, `done` stays set
    on that slot until the caller explicitly calls `reset_slots`.  That keeps
    episode boundaries under the collector's control.
    """

    def __init__(
        self,
        n_envs: int,
        sim_url: str = "http://127.0.0.1:3002",
        auto_advance: bool = True,
        client: SimClient | None = None,
    ):
        assert n_envs >= 1, "n_envs must be >= 1"
        self.n_envs = n_envs
        self.client = client or SimClient(base_url=sim_url)
        self._auto_advance = auto_advance
        self.slots: list[_Slot] = []
        # Reused across steps; callers must copy anything they keep past a step.
        self._obs = np.zeros((n_envs, STATE_DIM), dtype=np.float32)
        self._masks = np.zeros((n_envs, ACTION_SPACE_SIZE), dtype=bool)
        self._card_ids = np.zeros((n_envs, N_CARD_SLOTS), dtype=np.int64)

    # -- Lifecycle -------------------------------------------------------------

    def reset_all(self) -> None:
        """Start (or restart) every slot in a single request."""
        session_ids = [s.session_id for s in self.slots] if self.slots else None
        results = self.client.reset_batch(
            session_ids=session_ids,
            count=None if session_ids else self.n_envs,
            auto_advance=self._auto_advance,
            compact=True,
        )
        if not self.slots:
            self.slots = [_Slot(session_id=r["sessionId"]) for r in results]
        for i, result in enumerate(results):
            self._install(i, result["state"], result["legalMoves"], done=False, winner=None)

    def reset_slots(self, slots: list[int]) -> None:
        """Restart the given slots in a single request, reusing their session ids."""
        if not slots:
            return
        session_ids = [self.slots[i].session_id for i in slots]
        results = self.client.reset_batch(
            session_ids=session_ids, auto_advance=self._auto_advance, compact=True
        )
        for i, result in zip(slots, results):
            self._install(i, result["state"], result["legalMoves"], done=False, winner=None)

    def close(self) -> None:
        if self.slots:
            self.client.close_sessions([s.session_id for s in self.slots])
            self.slots = []

    # -- Observation views -----------------------------------------------------
    #
    # These are internal buffers refreshed in place on every step and reset, so
    # copy anything you need to keep beyond the next call.

    @property
    def obs(self) -> np.ndarray:
        return self._obs

    @property
    def masks(self) -> np.ndarray:
        return self._masks

    @property
    def card_ids(self) -> np.ndarray:
        return self._card_ids

    def active_slots(self) -> list[int]:
        return [i for i, s in enumerate(self.slots) if not s.done]

    # -- Stepping --------------------------------------------------------------

    def step(self, slots: list[int], action_indices: list[int]) -> dict[int, VecStepResult]:
        """
        Apply one action to each of `slots` in a single request.

        Returns a mapping slot -> VecStepResult.  Rewards are zero-sum and
        expressed from the perspective of the player who moved in that slot.
        """
        assert len(slots) == len(action_indices), "slots and action_indices must align"
        if not slots:
            return {}

        steps: list[dict] = []
        actors: list[int] = []
        for slot_idx, action_idx in zip(slots, action_indices):
            slot = self.slots[slot_idx]
            concrete = slot.index_map.get(action_idx)
            if concrete is None:
                raise RuntimeError(
                    f"VecSplendorDuelEnv.step: action {action_idx} is not legal in slot "
                    f"{slot_idx} (session={slot.session_id!r}). Masking should make this "
                    f"unreachable; {len(slot.index_map)} legal indices available."
                )
            actors.append(slot.current_player)
            steps.append({"sessionId": slot.session_id, "action": concrete})

        results = self.client.step_batch(
            steps, auto_advance=self._auto_advance, compact=True
        )

        out: dict[int, VecStepResult] = {}
        for slot_idx, actor, result in zip(slots, actors, results):
            if "error" in result:
                raise RuntimeError(
                    f"game-sim rejected a step for slot {slot_idx} "
                    f"(session={result.get('sessionId')!r}): {result['error']}"
                )
            done = bool(result["done"])
            winner = result["winner"]
            win_condition = result["state"].get("winCondition") if done else None
            self._install(
                slot_idx, result["state"], result["legalMoves"], done, winner, win_condition
            )
            out[slot_idx] = VecStepResult(
                actor=actor,
                reward=_reward_for_actor(actor, done, winner),
                done=done,
                winner=winner,
                win_condition=win_condition,
            )
        return out

    # -- Internals -------------------------------------------------------------

    def _install(
        self,
        i: int,
        state: dict,
        legal_moves: list[dict],
        done: bool,
        winner: int | None,
        win_condition: str | None = None,
    ) -> None:
        """Write one slot's new state through to the slot and the observation buffers."""
        slot = self.slots[i]
        slot.state = state
        slot.legal_moves = legal_moves
        slot.done = done
        slot.winner = winner
        slot.win_condition = win_condition

        index_map, mask = build_legal_index_map_and_mask(legal_moves)
        if legal_moves and not mask.any():
            raise RuntimeError(
                f"{len(legal_moves)} legal moves returned by server but none mapped to "
                f"canonical indices -- action_space coverage gap.\n"
                f"  First unmapped move: {legal_moves[0]}"
            )
        slot.index_map = index_map
        self._obs[i] = encode(state)
        self._masks[i] = mask
        self._card_ids[i] = encode_card_ids(state)
