"""
Fixed canonical action vocabulary of size 3981.

Index ranges:
  [0..144]    TAKE_TOKENS               — 145 valid board lines (1-3 cells)
  [145..211]  PURCHASE_CARD             — card id 1..67  (id-1 → offset)
  [212..278]  RESERVE_CARD_FROM_PYRAMID — card id 1..67
  [279..281]  RESERVE_CARD (deck)       — deck_1=279, deck_2=280, deck_3=281
  [282..616]  ASSIGN_WILD_COLOR         — 67 card ids × 5 gem colors (white/blue/green/red/black)
                                          index = 282 + (cardId-1)*5 + color_idx
  [617..761]  USE_PRIVILEGE             — 145 valid board lines (same order as TAKE_TOKENS)
  [762]       REPLENISH_BOARD
  [763]       END_OPTIONAL_PHASE
  [764]       SKIP_TO_MANDATORY
  [765..3943] DISCARD_TOKENS            — 3179 precomputed discard combos (excess 1-7, max 4 per color)
  [3944..3968] TAKE_TOKEN_FROM_BOARD    — 25 board positions (index 0-24)
  [3969..3975] TAKE_TOKEN_FROM_OPPONENT — 7 token colors
  [3976..3979] CHOOSE_ROYAL_CARD        — royal card id 1..4
  [3980]       PASS_MANDATORY           — no legal moves; end mandatory step (triggers discard if needed)
"""

from __future__ import annotations

from itertools import combinations as _combinations

import numpy as np

ACTION_SPACE_SIZE = 3981

TOKEN_COLORS = ["white", "blue", "green", "red", "black", "pearl", "gold"]
GEM_COLORS = ["white", "blue", "green", "red", "black"]  # valid colors for ASSIGN_WILD_COLOR

# ── Valid board lines ─────────────────────────────────────────────────────────

def _coord(idx: int) -> tuple[int, int]:
    return divmod(idx, 5)


def _is_valid_token_line(indices: tuple[int, ...]) -> bool:
    if not (1 <= len(indices) <= 3):
        return False
    if len(indices) == 1:
        return True
    coords = [_coord(i) for i in indices]
    dr = coords[1][0] - coords[0][0]
    dc = coords[1][1] - coords[0][1]
    if abs(dr) > 1 or abs(dc) > 1 or (dr == 0 and dc == 0):
        return False
    for k in range(2, len(coords)):
        if coords[k][0] - coords[k - 1][0] != dr:
            return False
        if coords[k][1] - coords[k - 1][1] != dc:
            return False
    return True


def _build_valid_lines() -> list[tuple[int, ...]]:
    lines = []
    for length in range(1, 4):
        for combo in _combinations(range(25), length):
            if _is_valid_token_line(combo):
                lines.append(combo)
    return lines  # exactly 145 entries


VALID_LINES: list[tuple[int, ...]] = _build_valid_lines()
LINE_TO_IDX: dict[tuple[int, ...], int] = {line: i for i, line in enumerate(VALID_LINES)}

# ── Valid discard combos ──────────────────────────────────────────────────────

def _build_discard_combos() -> list[dict[str, int]]:
    """
    All ways to discard 1-7 tokens distributed across 7 colors (max 4 per color).

    Max excess of 7 covers the worst case: 3 privileges + 3 TAKE_TOKENS + 1 ability token.
    Max 4 per color matches STARTING_GEM_COUNT (the most tokens of any one color in the game).
    Produces exactly 3179 entries.
    """
    combos: list[dict[str, int]] = []

    def recurse(remaining: int, color_idx: int, current: dict) -> None:
        if remaining == 0:
            combos.append(dict(current))
            return
        if color_idx >= 7:
            return
        color = TOKEN_COLORS[color_idx]
        for d in range(min(remaining, 4) + 1):
            if d > 0:
                current[color] = d
            recurse(remaining - d, color_idx + 1, current)
            if d > 0:
                del current[color]

    for excess in range(1, 8):
        recurse(excess, 0, {})
    return combos  # exactly 3179 entries


DISCARD_COMBOS: list[dict[str, int]] = _build_discard_combos()
DISCARD_TO_IDX: dict[tuple[tuple[str, int], ...], int] = {
    tuple(sorted(d.items())): i for i, d in enumerate(DISCARD_COMBOS)
}

# ── Offset constants ──────────────────────────────────────────────────────────

OFFSET_TAKE_TOKENS = 0        # 0..144
OFFSET_PURCHASE_CARD = 145    # 145..211   (card id 1..67)
OFFSET_RESERVE_PYRAMID = 212  # 212..278   (card id 1..67)
OFFSET_RESERVE_DECK = 279     # 279..281
OFFSET_ASSIGN_WILD = 282      # 282..616   (card id 1..67, color idx 0..4; stride 5)
OFFSET_USE_PRIVILEGE = 617    # 617..761
OFFSET_REPLENISH = 762        # 762
OFFSET_END_OPTIONAL = 763     # 763
OFFSET_SKIP_TO_MANDATORY = 764  # 764
OFFSET_DISCARD = 765          # 765..3943  (3179 combos)
OFFSET_TAKE_FROM_BOARD = 3944  # 3944..3968  (25 board positions)
OFFSET_TAKE_FROM_OPPONENT = 3969  # 3969..3975
OFFSET_CHOOSE_ROYAL = 3976        # 3976..3979  (royal card id 1..4)
OFFSET_PASS_MANDATORY = 3980      # 3980

_DECK_TO_IDX = {"deck_1": 279, "deck_2": 280, "deck_3": 281}

# ── Conversion functions ──────────────────────────────────────────────────────

def action_to_index(action: dict) -> int | None:
    """Convert a concrete Action dict to its canonical index. Returns None if unmappable."""
    t = action.get("type")

    if t == "TAKE_TOKENS":
        key = tuple(sorted(action.get("indices", [])))
        idx = LINE_TO_IDX.get(key)
        return None if idx is None else OFFSET_TAKE_TOKENS + idx

    if t == "PURCHASE_CARD":
        card_id = action.get("cardId", 0)
        if 1 <= card_id <= 67:
            return OFFSET_PURCHASE_CARD + (card_id - 1)

    if t == "RESERVE_CARD_FROM_PYRAMID":
        card_id = action.get("cardId", 0)
        if 1 <= card_id <= 67:
            return OFFSET_RESERVE_PYRAMID + (card_id - 1)

    if t == "RESERVE_CARD":
        source = action.get("source", "")
        return _DECK_TO_IDX.get(source)

    if t == "ASSIGN_WILD_COLOR":
        card_id = action.get("wildCardId", 0)
        color = action.get("color", "")
        if 1 <= card_id <= 67 and color in GEM_COLORS:
            return OFFSET_ASSIGN_WILD + (card_id - 1) * 5 + GEM_COLORS.index(color)

    if t == "USE_PRIVILEGE":
        key = tuple(sorted(action.get("indices", [])))
        idx = LINE_TO_IDX.get(key)
        return None if idx is None else OFFSET_USE_PRIVILEGE + idx

    if t == "REPLENISH_BOARD":
        return OFFSET_REPLENISH

    if t == "END_OPTIONAL_PHASE":
        return OFFSET_END_OPTIONAL

    if t == "SKIP_TO_MANDATORY":
        return OFFSET_SKIP_TO_MANDATORY

    if t == "DISCARD_TOKENS":
        key = tuple(sorted(action.get("tokens", {}).items()))
        idx = DISCARD_TO_IDX.get(key)
        return None if idx is None else OFFSET_DISCARD + idx

    if t == "TAKE_TOKEN_FROM_BOARD":
        idx = action.get("index")
        if isinstance(idx, int) and 0 <= idx <= 24:
            return OFFSET_TAKE_FROM_BOARD + idx

    if t == "TAKE_TOKEN_FROM_OPPONENT":
        color = action.get("color", "")
        if color in TOKEN_COLORS:
            return OFFSET_TAKE_FROM_OPPONENT + TOKEN_COLORS.index(color)

    if t == "CHOOSE_ROYAL_CARD":
        card_id = action.get("cardId", 0)
        if 1 <= card_id <= 4:
            return OFFSET_CHOOSE_ROYAL + (card_id - 1)

    if t == "PASS_MANDATORY":
        return OFFSET_PASS_MANDATORY

    return None


def index_to_action(idx: int, legal_moves: list[dict]) -> dict | None:
    """
    Return the legal action matching canonical index idx.
    Cross-references the legal moves list rather than reconstructing,
    so goldUsage and other fields are preserved exactly.
    """
    for action in legal_moves:
        if action_to_index(action) == idx:
            return action
    return None


def build_legal_index_map(legal_moves: list[dict]) -> dict[int, dict]:
    """Return a dict mapping canonical action index → action dict for all legal moves."""
    result: dict[int, dict] = {}
    for action in legal_moves:
        idx = action_to_index(action)
        if idx is not None:
            assert idx not in result, (
                f"Duplicate canonical index {idx} produced by two different legal moves: "
                f"{result[idx]} and {action}"
            )
            result[idx] = action
    return result


def build_legal_mask(legal_moves: list[dict]) -> np.ndarray:
    """Return a bool array of shape (ACTION_SPACE_SIZE,) with True at each legal action's index."""
    mask = np.zeros(ACTION_SPACE_SIZE, dtype=bool)
    for action in legal_moves:
        idx = action_to_index(action)
        if idx is not None:
            mask[idx] = True
    return mask
