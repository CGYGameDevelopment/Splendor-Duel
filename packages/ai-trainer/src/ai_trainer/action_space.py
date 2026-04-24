"""
Fixed canonical action vocabulary of size 688.

Index ranges:
  [0..144]    TAKE_TOKENS               — 145 valid board lines (1-3 cells)
  [145..211]  PURCHASE_CARD             — card id 1..67  (id-1 → offset)
  [212..278]  RESERVE_CARD_FROM_PYRAMID — card id 1..67
  [279..281]  RESERVE_CARD_FROM_DECK    — deck_1=279, deck_2=280, deck_3=281
  [282..616]  ASSIGN_WILD_COLOR         — 67 card ids × 5 gem colors (white/blue/green/red/black)
                                          index = 282 + (cardId-1)*5 + color_idx
  [617..641]  USE_PRIVILEGE             — 25 single board cell indices (0-24)
  [642]       REPLENISH_BOARD
  [643]       END_OPTIONAL_PHASE
  [644]       SKIP_TO_MANDATORY
  [645..651]  DISCARD_TOKENS            — 7 token colors (discard exactly 1 of that color)
  [652..676]  TAKE_TOKEN_FROM_BOARD     — 25 board positions (index 0-24)
  [677..682]  TAKE_TOKEN_FROM_OPPONENT  — 6 token colors (white,blue,green,red,black,pearl)
  [683..686]  CHOOSE_ROYAL_CARD         — royal card id 1..4
  [687]       PASS_MANDATORY
"""

from __future__ import annotations

import logging
from itertools import combinations as _combinations

import numpy as np

logger = logging.getLogger(__name__)

ACTION_SPACE_SIZE = 688

TOKEN_COLORS = ["white", "blue", "green", "red", "black", "pearl", "gold"]
GEM_COLORS = ["white", "blue", "green", "red", "black"]
TAKE_FROM_OPPONENT_COLORS = ["white", "blue", "green", "red", "black", "pearl"]

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

# ── Offset constants ──────────────────────────────────────────────────────────

OFFSET_TAKE_TOKENS = 0        # 0..144
OFFSET_PURCHASE_CARD = 145    # 145..211   (card id 1..67)
OFFSET_RESERVE_PYRAMID = 212  # 212..278   (card id 1..67)
OFFSET_RESERVE_DECK = 279     # 279..281
OFFSET_ASSIGN_WILD = 282      # 282..616   (card id 1..67, color idx 0..4; stride 5)
OFFSET_USE_PRIVILEGE = 617    # 617..641   (single board cell 0-24)
OFFSET_REPLENISH = 642        # 642
OFFSET_END_OPTIONAL = 643     # 643
OFFSET_SKIP_TO_MANDATORY = 644  # 644
OFFSET_DISCARD = 645          # 645..651   (one entry per token color)
OFFSET_TAKE_FROM_BOARD = 652  # 652..676   (25 board positions)
OFFSET_TAKE_FROM_OPPONENT = 677  # 677..682  (6 colors: gem colors + pearl)
OFFSET_CHOOSE_ROYAL = 683        # 683..686  (royal card id 1..4)
OFFSET_PASS_MANDATORY = 687      # 687

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

    if t == "RESERVE_CARD_FROM_DECK":
        source = action.get("source", "")
        return _DECK_TO_IDX.get(source)

    if t == "ASSIGN_WILD_COLOR":
        card_id = action.get("wildCardId", 0)
        color = action.get("color", "")
        if 1 <= card_id <= 67 and color in GEM_COLORS:
            return OFFSET_ASSIGN_WILD + (card_id - 1) * 5 + GEM_COLORS.index(color)

    if t == "USE_PRIVILEGE":
        indices = action.get("indices", [])
        if len(indices) == 1 and 0 <= indices[0] <= 24:
            return OFFSET_USE_PRIVILEGE + indices[0]

    if t == "REPLENISH_BOARD":
        return OFFSET_REPLENISH

    if t == "END_OPTIONAL_PHASE":
        return OFFSET_END_OPTIONAL

    if t == "SKIP_TO_MANDATORY":
        return OFFSET_SKIP_TO_MANDATORY

    if t == "DISCARD_TOKENS":
        tokens = action.get("tokens", {})
        if len(tokens) == 1:
            color = next(iter(tokens))
            if tokens[color] == 1 and color in TOKEN_COLORS:
                return OFFSET_DISCARD + TOKEN_COLORS.index(color)

    if t == "TAKE_TOKEN_FROM_BOARD":
        idx = action.get("index")
        if isinstance(idx, int) and 0 <= idx <= 24:
            return OFFSET_TAKE_FROM_BOARD + idx

    if t == "TAKE_TOKEN_FROM_OPPONENT":
        color = action.get("color", "")
        if color in TAKE_FROM_OPPONENT_COLORS:
            return OFFSET_TAKE_FROM_OPPONENT + TAKE_FROM_OPPONENT_COLORS.index(color)

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
    index_map, _ = build_legal_index_map_and_mask(legal_moves)
    return index_map


def build_legal_index_map_and_mask(
    legal_moves: list[dict],
) -> tuple[dict[int, dict], np.ndarray]:
    """Return (index_map, mask) in a single pass over legal_moves."""
    index_map: dict[int, dict] = {}
    mask = np.zeros(ACTION_SPACE_SIZE, dtype=bool)
    for action in legal_moves:
        idx = action_to_index(action)
        if idx is None:
            logger.warning("build_legal_index_map: unmapped legal action %s", action)
            continue
        assert idx not in index_map, (
            f"Duplicate canonical index {idx} produced by two different legal moves: "
            f"{index_map[idx]} and {action}"
        )
        index_map[idx] = action
        mask[idx] = True
    return index_map, mask


def build_legal_mask(legal_moves: list[dict]) -> np.ndarray:
    """Return a bool array of shape (ACTION_SPACE_SIZE,) with True at each legal action's index."""
    mask = np.zeros(ACTION_SPACE_SIZE, dtype=bool)
    for action in legal_moves:
        idx = action_to_index(action)
        if idx is not None:
            mask[idx] = True
    return mask
