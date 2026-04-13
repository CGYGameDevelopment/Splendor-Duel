"""
GameState dict → flat float32 numpy array of shape (858,).

Layout (always from the current player's perspective):
  [0..199]    Board:          25 cells × 8  (one-hot: 7 token colors + empty)
  [200..206]  Bag:            7 token counts / 10
  [207..518]  Pyramid:        12 card slots × 26 features  (level1: 5, level2: 4, level3: 3)
  [519..521]  Deck sizes:     3 values / 30
  [522..625]  Royal deck:     4 card slots × 26 features
  [626]       Table privs:    count / 3
  [627..734]  Current player: 108 features
  [735..842]  Opponent:       108 features
  [843..848]  Phase:          6 one-hot
  [849]       currentPlayer:  raw 0 or 1
  [850]       extraTurns:     / 3
  [851..857]  pendingAbility: 7 one-hot (6 abilities + none)

  TOTAL: 858

Per-card features (26):
  [0..7]   color one-hot (8): white/blue/green/red/black/joker/points + absent=7
  [8]      present bit
  [9]      points / 6
  [10]     bonus / 2
  [11..16] ability one-hot (6 abilities)
  [17]     no-ability bit
  [18]     crowns / 3
  [19..25] cost per token color / 8

Per-player features (108):
  [0..6]   tokens (7 colors) / 10
  [7..11]  bonuses per gem color (5) / 5
  [12..16] prestige per gem color (5) / 10
  [17]     total prestige / 20
  [18]     crowns / 10
  [19]     privileges / 3
  [20]     reserved card count / 3
  [21..46] reserved card 0 (26 features)
  [47..72] reserved card 1 (26 features)
  [73..98] reserved card 2 (26 features)
  [99..107] royal cards: 9 floats (3 royals × 3 scalar features: points/6, crowns/3, has_ability)
"""

from __future__ import annotations

import numpy as np

STATE_DIM = 858

TOKEN_COLORS = ["white", "blue", "green", "red", "black", "pearl", "gold"]
GEM_COLORS = ["white", "blue", "green", "red", "black"]
CARD_COLORS = ["white", "blue", "green", "red", "black", "joker", "points"]  # index 7 = absent
ABILITIES = ["Turn", "Token", "Bonus", "Take", "Privilege", "Bonus/Turn"]
PHASES = [
    "optional_privilege",
    "optional_replenish",
    "mandatory",
    "discard",
    "resolve_ability",
    "place_bonus",
    # "game_over" is intentionally excluded: the encoder is never called on terminal
    # states during training (the episode loop exits before the obs is used).
    # Including it would shift all subsequent indices and change STATE_DIM.
]

CARD_FEATURES = 26
PLAYER_FEATURES = 108

# Normalization divisors — adjust these if the game's numeric ranges change.
_TOKEN_SCALE = 10.0          # token counts per color
_POINTS_SCALE = 6.0          # card point values
_BONUS_SCALE = 2.0           # card bonus values
_COST_SCALE = 8.0            # token cost per color
_CARD_CROWNS_SCALE = 3.0     # crowns on a card
_DECK_SCALE = 30.0           # cards remaining in a deck
_BONUS_COLOR_SCALE = 5.0     # purchased bonuses per gem color
_PRESTIGE_COLOR_SCALE = 10.0 # prestige earned per gem color
_TOTAL_PRESTIGE_SCALE = 20.0 # total prestige points
_PLAYER_CROWNS_SCALE = 10.0  # total crowns on a player
_PRIVILEGES_SCALE = 3.0      # privilege tokens
_RESERVED_SCALE = 3.0        # reserved card count
_EXTRA_TURNS_SCALE = 3.0     # extraTurns counter
_TABLE_PRIV_SCALE = 3.0      # table-level privilege count


# ── Per-card encoding ─────────────────────────────────────────────────────────

def _encode_card(card: dict | None, out: np.ndarray, offset: int) -> None:
    """Write 26 floats for one card slot starting at out[offset]. Zeros if absent."""
    if card is None:
        return  # already zero-initialised by caller

    color = card.get("color", "points")
    if color in CARD_COLORS:
        out[offset + CARD_COLORS.index(color)] = 1.0
    # index 7 = absent — left 0 since card is present
    out[offset + 8] = 1.0  # present bit
    out[offset + 9] = card.get("points", 0) / _POINTS_SCALE
    out[offset + 10] = card.get("bonus", 0) / _BONUS_SCALE

    ability = card.get("ability")
    if ability and ability in ABILITIES:
        out[offset + 11 + ABILITIES.index(ability)] = 1.0
    else:
        out[offset + 17] = 1.0  # no-ability bit

    out[offset + 18] = card.get("crowns", 0) / _CARD_CROWNS_SCALE

    cost = card.get("cost", {})
    for ci, color_name in enumerate(TOKEN_COLORS):
        out[offset + 19 + ci] = cost.get(color_name, 0) / _COST_SCALE


# ── Per-player encoding ───────────────────────────────────────────────────────

def _encode_player(player: dict, out: np.ndarray, offset: int) -> None:
    """Write 108 floats for one player starting at out[offset]."""
    tokens = player.get("tokens", {})
    for ci, color in enumerate(TOKEN_COLORS):
        out[offset + ci] = tokens.get(color, 0) / _TOKEN_SCALE

    # Bonuses per gem color (purchased card bonuses)
    purchased = player.get("purchasedCards", [])
    bonuses: dict[str, float] = {c: 0.0 for c in GEM_COLORS}
    prestige_by_color: dict[str, float] = {c: 0.0 for c in GEM_COLORS}
    for card in purchased:
        effective_color = card.get("assignedColor") or card.get("color")
        if effective_color in GEM_COLORS:
            bonuses[effective_color] += card.get("bonus", 0)
            prestige_by_color[effective_color] += card.get("points", 0)

    for ci, color in enumerate(GEM_COLORS):
        out[offset + 7 + ci] = bonuses[color] / _BONUS_COLOR_SCALE
        out[offset + 12 + ci] = prestige_by_color[color] / _PRESTIGE_COLOR_SCALE

    out[offset + 17] = player.get("prestige", 0) / _TOTAL_PRESTIGE_SCALE
    out[offset + 18] = player.get("crowns", 0) / _PLAYER_CROWNS_SCALE
    out[offset + 19] = player.get("privileges", 0) / _PRIVILEGES_SCALE

    reserved = player.get("reservedCards", [])
    out[offset + 20] = len(reserved) / _RESERVED_SCALE
    for i in range(3):
        card = reserved[i] if i < len(reserved) else None
        _encode_card(card, out, offset + 21 + i * CARD_FEATURES)

    # Royal cards: encode first 3 as compact scalar triples
    # Slots: points/6, crowns/3, has_ability (1.0 if the card has an ability else 0.0)
    # Note: Card has no "prestige" field — prestige is on PlayerState, not Card.
    royals = player.get("royalCards", [])
    for i in range(3):
        if i < len(royals):
            r = royals[i]
            base = offset + 99 + i * 3
            out[base] = r.get("points", 0) / _POINTS_SCALE
            out[base + 1] = r.get("crowns", 0) / _CARD_CROWNS_SCALE
            out[base + 2] = 1.0 if r.get("ability") is not None else 0.0


# ── Main encode function ──────────────────────────────────────────────────────

def encode(state: dict) -> np.ndarray:
    """Encode a GameState dict into a float32 array of shape (858,)."""
    out = np.zeros(STATE_DIM, dtype=np.float32)
    current_player_idx: int = state.get("currentPlayer", 0)

    # Board: 25 cells × 8
    # The game state serialises board cells as plain strings (e.g. "black") or null.
    board = state.get("board", [])
    for cell_idx, cell in enumerate(board[:25]):
        if isinstance(cell, str) and cell in TOKEN_COLORS:
            out[cell_idx * 8 + TOKEN_COLORS.index(cell)] = 1.0
        else:
            out[cell_idx * 8 + 7] = 1.0  # empty

    # Bag
    bag = state.get("bag", {})
    for ci, color in enumerate(TOKEN_COLORS):
        out[200 + ci] = bag.get(color, 0) / _TOKEN_SCALE

    # Pyramid (12 card slots: 5 + 4 + 3)
    pyramid = state.get("pyramid", {})
    pyramid_offset = 207
    slot = 0
    for level_key in ("level1", "level2", "level3"):
        for card in pyramid.get(level_key, []):
            _encode_card(card, out, pyramid_offset + slot * CARD_FEATURES)
            slot += 1
    # Pad remaining slots with zeros (already zero)

    # Deck sizes
    decks = state.get("decks", {})
    out[519] = len(decks.get("level1", [])) / _DECK_SCALE
    out[520] = len(decks.get("level2", [])) / _DECK_SCALE
    out[521] = len(decks.get("level3", [])) / _DECK_SCALE

    # Royal deck (4 slots)
    royal_deck = state.get("royalDeck", [])
    for i, card in enumerate(royal_deck[:4]):
        _encode_card(card, out, 522 + i * CARD_FEATURES)

    # Table privileges
    out[626] = state.get("privileges", 0) / _TABLE_PRIV_SCALE

    # Players — always encode current player first
    players = state.get("players", [{}, {}])
    opponent_idx = 1 - current_player_idx
    _encode_player(players[current_player_idx], out, 627)
    _encode_player(players[opponent_idx], out, 735)

    # Phase
    phase = state.get("phase", "mandatory")
    if phase in PHASES:
        out[843 + PHASES.index(phase)] = 1.0

    out[849] = float(current_player_idx)
    out[850] = state.get("extraTurns", 0) / _EXTRA_TURNS_SCALE

    # Pending ability
    pending = state.get("pendingAbility")
    if pending and pending in ABILITIES:
        out[851 + ABILITIES.index(pending)] = 1.0
    else:
        out[857] = 1.0  # none

    return out
