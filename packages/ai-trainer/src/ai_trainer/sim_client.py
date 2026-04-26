"""HTTP client wrapping the ai-game-sim server."""

from __future__ import annotations

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

_TIMEOUT = 10  # seconds — applied to all requests

# Retry on connection errors for all methods, including POST/DELETE.
# This handles stale keep-alive connections: after the PPO update the
# Node.js server may have closed the connection server-side, causing
# the next request on the pooled socket to fail with ConnectionError.
_RETRY = Retry(
    connect=3,
    backoff_factor=0.3,
    allowed_methods={"DELETE", "GET", "HEAD", "OPTIONS", "POST", "PUT"},
)
_ADAPTER = HTTPAdapter(max_retries=_RETRY)


class SimClient:
    """Thin synchronous HTTP wrapper around the ai-game-sim server."""

    def __init__(self, base_url: str = "http://127.0.0.1:3002"):
        self.base_url = base_url.rstrip("/")
        self._session = requests.Session()
        self._session.mount("http://", _ADAPTER)
        self._session.mount("https://", _ADAPTER)

    def reset(
        self,
        session_id: str | None = None,
        second_player_gets_privilege: bool = True,
    ) -> dict:
        """Start a new game. Returns {sessionId, state, legalMoves}."""
        payload: dict = {"secondPlayerGetsPrivilege": second_player_gets_privilege}
        if session_id is not None:
            payload["sessionId"] = session_id
        r = self._session.post(f"{self.base_url}/reset", json=payload, timeout=_TIMEOUT)
        r.raise_for_status()
        return r.json()

    def step(self, session_id: str, action: dict) -> dict:
        """Apply an action. Returns {state, legalMoves, done, winner}."""
        r = self._session.post(
            f"{self.base_url}/step",
            json={"sessionId": session_id, "action": action},
            timeout=_TIMEOUT,
        )
        r.raise_for_status()
        return r.json()

    def legal_moves(self, session_id: str) -> list[dict]:
        """Returns the list of legal Action dicts for the current state."""
        r = self._session.post(
            f"{self.base_url}/legal-moves",
            json={"sessionId": session_id},
            timeout=_TIMEOUT,
        )
        r.raise_for_status()
        return r.json()["legalMoves"]

    def close_session(self, session_id: str) -> None:
        """Free the server-side session."""
        self._session.delete(f"{self.base_url}/session/{session_id}", timeout=_TIMEOUT)

    def health(self) -> bool:
        """Returns True if the game-sim server is reachable."""
        try:
            r = self._session.get(f"{self.base_url}/health", timeout=2)
            return r.status_code == 200
        except (requests.ConnectionError, requests.Timeout):
            return False
