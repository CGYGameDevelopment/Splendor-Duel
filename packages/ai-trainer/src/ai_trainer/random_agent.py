"""Baseline agents used for evaluation."""

from __future__ import annotations

import numpy as np

from .action_space import action_to_index
from .tactics import (
    SPENDABLE_COLORS,
    build_card_maps,
    can_afford,
    player_resources,
    would_win,
)


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


class GreedyPurchaseAgent:
    """
    Greedy agent with the following priority order:

      1. Purchase a card that immediately satisfies a victory condition.
      2. Purchase (or reserve) a pyramid card that the opponent could use to win on their turn.
      3. Purchase the highest-level pyramid card available (level 3 > 2 > 1).
      4. Take tokens, preferring colours with the fewest combined tokens + bonuses.
      5. When discarding, never discard a gold token.
    """

    def __init__(self, rng: np.random.Generator | None = None) -> None:
        self.rng = rng or np.random.default_rng()

    def act(self, legal_moves: list[dict], legal_mask: np.ndarray, state: dict) -> int:
        current_player_idx = state.get("currentPlayer", 0)
        players = state.get("players", [{}, {}])
        me = players[current_player_idx]
        opponent = players[1 - current_player_idx]

        card_lookup, card_level = build_card_maps(state)

        purchase_moves: list[tuple[dict, int]] = []
        reserve_pyramid_moves: list[tuple[dict, int]] = []
        take_token_moves: list[tuple[dict, int]] = []
        discard_moves: list[tuple[dict, int]] = []

        for move in legal_moves:
            idx = action_to_index(move)
            if idx is None:
                continue
            t = move.get("type")
            if t == "PURCHASE_CARD":
                purchase_moves.append((move, idx))
            elif t == "RESERVE_CARD_FROM_PYRAMID":
                reserve_pyramid_moves.append((move, idx))
            elif t == "TAKE_TOKENS":
                take_token_moves.append((move, idx))
            elif t == "DISCARD_TOKENS":
                discard_moves.append((move, idx))

        # Rule 5: When discarding, never discard gold.
        if discard_moves:
            safe = [(m, i) for m, i in discard_moves if m.get("color") != "gold"]
            pool = safe if safe else discard_moves
            return pool[int(self.rng.integers(len(pool)))][1]

        # Rule 1: Purchase a card that immediately wins the game.
        winning = [
            (m, i)
            for m, i in purchase_moves
            if (card := card_lookup.get(m.get("cardId"))) and would_win(me, card)
        ]
        if winning:
            best_level = max(card_level.get(m.get("cardId", 0), 0) for m, _ in winning)
            candidates = [
                i for m, i in winning if card_level.get(m.get("cardId", 0), 0) == best_level
            ]
            return int(self.rng.choice(candidates))

        # Rule 2: Block opponent from winning — purchase the card if possible, else reserve it.
        pyramid = state.get("pyramid", {})
        threat_ids: set[int] = set()
        for key in ("level1", "level2", "level3"):
            for card in pyramid.get(key, []):
                if card is None:
                    continue
                if would_win(opponent, card) and can_afford(opponent, card):
                    threat_ids.add(card.get("id"))

        if threat_ids:
            block_buy = [(m, i) for m, i in purchase_moves if m.get("cardId") in threat_ids]
            if block_buy:
                return block_buy[int(self.rng.integers(len(block_buy)))][1]
            block_reserve = [
                (m, i) for m, i in reserve_pyramid_moves if m.get("cardId") in threat_ids
            ]
            if block_reserve:
                return block_reserve[int(self.rng.integers(len(block_reserve)))][1]

        # Rule 3: Purchase the highest-level pyramid card available.
        pyramid_purchases = [
            (m, i) for m, i in purchase_moves if card_level.get(m.get("cardId", 0), 0) > 0
        ]
        if pyramid_purchases:
            best_level = max(card_level.get(m.get("cardId", 0), 0) for m, _ in pyramid_purchases)
            candidates = [
                i
                for m, i in pyramid_purchases
                if card_level.get(m.get("cardId", 0), 0) == best_level
            ]
            return int(self.rng.choice(candidates))

        if purchase_moves:
            return purchase_moves[int(self.rng.integers(len(purchase_moves)))][1]

        # Rule 4: Take tokens, preferring colours we're shortest on.
        if take_token_moves:
            resources = player_resources(me)
            board = state.get("board", [])

            def _score_take(move: dict) -> float:
                colors = [
                    board[i]
                    for i in move.get("indices", [])
                    if isinstance(i, int) and i < len(board) and board[i] in SPENDABLE_COLORS
                ]
                return sum(1.0 / (resources.get(c, 0) + 1) for c in colors)

            best_score = -1.0
            best_idx = -1
            for move, idx in take_token_moves:
                s = _score_take(move)
                if s > best_score:
                    best_score = s
                    best_idx = idx
            if best_idx >= 0:
                return best_idx

        # Fallback: random legal action.
        legal_indices = np.where(legal_mask)[0]
        return int(self.rng.choice(legal_indices))
