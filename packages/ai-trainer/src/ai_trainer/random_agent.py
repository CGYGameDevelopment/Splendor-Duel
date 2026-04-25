"""Baseline agents used for evaluation."""

from __future__ import annotations

import numpy as np

from .action_space import action_to_index

_GEM_COLORS = ["white", "blue", "green", "red", "black"]
_SPENDABLE_COLORS = ["white", "blue", "green", "red", "black", "pearl"]


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


def _build_card_maps(state: dict) -> tuple[dict[int, dict], dict[int, int]]:
    """
    Single-pass build of two lookups from the current state:
      card_lookup: cardId -> card dict  (pyramid + reserved cards)
      card_level:  cardId -> level 1/2/3  (pyramid cards only)
    """
    card_lookup: dict[int, dict] = {}
    card_level: dict[int, int] = {}
    pyramid = state.get("pyramid", {})
    for level_num, key in enumerate(("level1", "level2", "level3"), start=1):
        for card in pyramid.get(key, []):
            if card is not None:
                cid = card.get("id")
                if cid is not None:
                    card_lookup[cid] = card
                    card_level[cid] = level_num
    for player in state.get("players", []):
        for card in player.get("reservedCards", []):
            if card is not None and card.get("id") is not None:
                card_lookup[card["id"]] = card
    return card_lookup, card_level


def _prestige_per_color(player: dict) -> dict[str, float]:
    """Return current prestige points per gem color for a player."""
    by_color: dict[str, float] = {c: 0.0 for c in _GEM_COLORS}
    for card in player.get("purchasedCards", []):
        color = card.get("assignedColor") or card.get("color")
        if color in _GEM_COLORS:
            by_color[color] += card.get("points", 0)
    return by_color


def _would_win(player: dict, card: dict) -> bool:
    """Return True if purchasing card would trigger a victory condition for player."""
    card_points = card.get("points", 0)
    card_color = card.get("assignedColor") or card.get("color")
    card_crowns = card.get("crowns", 0)

    if player.get("prestige", 0) + card_points >= 20:
        return True
    if player.get("crowns", 0) + card_crowns >= 10:
        return True
    if card_color in _GEM_COLORS:
        ppc = _prestige_per_color(player)
        if ppc.get(card_color, 0) + card_points >= 10:
            return True
    return False


def _can_afford(player: dict, card: dict) -> bool:
    """Return True if player has enough tokens (using gold as wild) to purchase card."""
    tokens = player.get("tokens", {})
    bonuses: dict[str, int] = {c: 0 for c in _GEM_COLORS}
    for purchased in player.get("purchasedCards", []):
        color = purchased.get("assignedColor") or purchased.get("color")
        if color in _GEM_COLORS:
            bonuses[color] += purchased.get("bonus", 0)

    cost = card.get("cost", {})
    gold_available = tokens.get("gold", 0)
    gold_needed = 0
    for color in _SPENDABLE_COLORS:
        shortfall = max(0, cost.get(color, 0) - bonuses.get(color, 0) - tokens.get(color, 0))
        gold_needed += shortfall

    return gold_needed <= gold_available


def _player_resources(player: dict) -> dict[str, int]:
    """Count tokens + bonuses per spendable color to gauge gem supply."""
    tokens = player.get("tokens", {})
    bonuses: dict[str, int] = {c: 0 for c in _GEM_COLORS}
    for card in player.get("purchasedCards", []):
        color = card.get("assignedColor") or card.get("color")
        if color in _GEM_COLORS:
            bonuses[color] += card.get("bonus", 0)
    return {c: tokens.get(c, 0) + bonuses.get(c, 0) for c in _SPENDABLE_COLORS}


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

        card_lookup, card_level = _build_card_maps(state)

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
            safe = [(m, i) for m, i in discard_moves if "gold" not in m.get("tokens", {})]
            pool = safe if safe else discard_moves
            return pool[int(self.rng.integers(len(pool)))][1]

        # Rule 1: Purchase a card that immediately wins the game.
        winning = [
            (m, i) for m, i in purchase_moves
            if (card := card_lookup.get(m.get("cardId"))) and _would_win(me, card)
        ]
        if winning:
            best_level = max(card_level.get(m.get("cardId", 0), 0) for m, _ in winning)
            candidates = [i for m, i in winning if card_level.get(m.get("cardId", 0), 0) == best_level]
            return int(self.rng.choice(candidates))

        # Rule 2: Block opponent from winning — purchase the card if possible, else reserve it.
        pyramid = state.get("pyramid", {})
        threat_ids: set[int] = set()
        for key in ("level1", "level2", "level3"):
            for card in pyramid.get(key, []):
                if card is None:
                    continue
                if _would_win(opponent, card) and _can_afford(opponent, card):
                    threat_ids.add(card.get("id"))

        if threat_ids:
            block_buy = [(m, i) for m, i in purchase_moves if m.get("cardId") in threat_ids]
            if block_buy:
                return block_buy[int(self.rng.integers(len(block_buy)))][1]
            block_reserve = [(m, i) for m, i in reserve_pyramid_moves if m.get("cardId") in threat_ids]
            if block_reserve:
                return block_reserve[int(self.rng.integers(len(block_reserve)))][1]

        # Rule 3: Purchase the highest-level pyramid card available.
        pyramid_purchases = [(m, i) for m, i in purchase_moves
                             if card_level.get(m.get("cardId", 0), 0) > 0]
        if pyramid_purchases:
            best_level = max(card_level.get(m.get("cardId", 0), 0) for m, _ in pyramid_purchases)
            candidates = [i for m, i in pyramid_purchases
                          if card_level.get(m.get("cardId", 0), 0) == best_level]
            return int(self.rng.choice(candidates))

        if purchase_moves:
            return purchase_moves[int(self.rng.integers(len(purchase_moves)))][1]

        # Rule 4: Take tokens, preferring colours we're shortest on.
        if take_token_moves:
            resources = _player_resources(me)
            board = state.get("board", [])

            def _score_take(move: dict) -> float:
                colors = [
                    board[i] for i in move.get("indices", [])
                    if isinstance(i, int) and i < len(board) and board[i] in _SPENDABLE_COLORS
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
