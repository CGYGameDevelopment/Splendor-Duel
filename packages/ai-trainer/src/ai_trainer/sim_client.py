"""HTTP client wrapping the ai-game-sim server."""

from __future__ import annotations

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

_TIMEOUT = 30  # seconds -- batch endpoints do more work per request than single steps

# Retry on connection errors for all methods, including POST/DELETE.
# This handles stale keep-alive connections: after the PPO update the
# Node.js server may have closed the connection server-side, causing
# the next request on the pooled socket to fail with ConnectionError.
_RETRY = Retry(
    connect=3,
    backoff_factor=0.3,
    allowed_methods={"DELETE", "GET", "HEAD", "OPTIONS", "POST", "PUT"},
)
# One pooled connection per parallel env, so batched rollouts do not
# serialise behind the default pool size of 10.
_ADAPTER = HTTPAdapter(max_retries=_RETRY, pool_connections=32, pool_maxsize=32)

# Each batch item carries a full GameState (~12 KB of JSON), so a large frontier
# is megabytes of body.  Chunking keeps any single request modest regardless of
# how wide the caller's batch is.
_MAX_ITEMS_PER_REQUEST = 64


def _chunks(items: list, size: int):
    for start in range(0, len(items), size):
        yield items[start : start + size]


class SimClient:
    """Thin synchronous HTTP wrapper around the ai-game-sim server."""

    def __init__(self, base_url: str = "http://127.0.0.1:3002"):
        self.base_url = base_url.rstrip("/")
        self._session = requests.Session()
        self._session.mount("http://", _ADAPTER)
        self._session.mount("https://", _ADAPTER)

    def _post(self, path: str, payload: dict) -> dict:
        r = self._session.post(f"{self.base_url}{path}", json=payload, timeout=_TIMEOUT)
        r.raise_for_status()
        return r.json()

    # -- Single-session API ----------------------------------------------------

    def reset(
        self,
        session_id: str | None = None,
        second_player_gets_privilege: bool = True,
        auto_advance: bool = True,
        compact: bool = False,
    ) -> dict:
        """Start a new game. Returns {sessionId, state, legalMoves}."""
        payload: dict = {
            "secondPlayerGetsPrivilege": second_player_gets_privilege,
            "autoAdvance": auto_advance,
            "compact": compact,
        }
        if session_id is not None:
            payload["sessionId"] = session_id
        return self._post("/reset", payload)

    def step(
        self, session_id: str, action: dict, auto_advance: bool = True, compact: bool = False
    ) -> dict:
        """Apply an action. Returns {state, legalMoves, done, winner, forced}."""
        return self._post(
            "/step",
            {
                "sessionId": session_id,
                "action": action,
                "autoAdvance": auto_advance,
                "compact": compact,
            },
        )

    def legal_moves(self, session_id: str) -> list[dict]:
        """Returns the list of legal Action dicts for the current state."""
        return self._post("/legal-moves", {"sessionId": session_id})["legalMoves"]

    def legal_moves_from_state(self, state: dict) -> list[dict]:
        """Returns the legal Action dicts for an arbitrary state (no session needed)."""
        return self._post("/legal-moves-from-state", {"state": state})["legalMoves"]

    def close_session(self, session_id: str) -> None:
        """Free the server-side session."""
        self._session.delete(f"{self.base_url}/session/{session_id}", timeout=_TIMEOUT)

    # -- Batch API -------------------------------------------------------------
    #
    # One round trip per *batch* rather than per *action*.  Per-action HTTP
    # latency, not engine compute, is what caps rollout throughput.

    def reset_batch(
        self,
        session_ids: list[str] | None = None,
        count: int | None = None,
        second_player_gets_privilege: bool = True,
        auto_advance: bool = True,
        compact: bool = False,
    ) -> list[dict]:
        """Start several games at once. Returns a list of {sessionId, state, legalMoves}."""
        payload: dict = {
            "secondPlayerGetsPrivilege": second_player_gets_privilege,
            "autoAdvance": auto_advance,
            "compact": compact,
        }
        if session_ids is not None:
            payload["sessionIds"] = session_ids
        elif count is not None:
            payload["count"] = count
        else:
            raise ValueError("reset_batch needs either session_ids or count")
        return self._post("/reset-batch", payload)["results"]

    def step_batch(
        self, steps: list[dict], auto_advance: bool = True, compact: bool = False
    ) -> list[dict]:
        """
        Apply one action per session in a single request.

        steps: [{"sessionId": str, "action": dict}, ...]
        Returns results in request order; a per-entry "error" key marks a
        failure on that session without failing the rest of the batch.
        """
        results: list[dict] = []
        for chunk in _chunks(steps, _MAX_ITEMS_PER_REQUEST):
            results.extend(
                self._post(
                    "/step-batch",
                    {"steps": chunk, "autoAdvance": auto_advance, "compact": compact},
                )["results"]
            )
        return results

    def close_sessions(self, session_ids: list[str]) -> None:
        """Free several server-side sessions in one request."""
        if session_ids:
            self._post("/sessions/close-batch", {"sessionIds": session_ids})

    # -- Health ----------------------------------------------------------------

    def health(self) -> bool:
        """Returns True if the game-sim server is reachable."""
        try:
            r = self._session.get(f"{self.base_url}/health", timeout=2)
            return r.status_code == 200
        except (requests.ConnectionError, requests.Timeout):
            return False
