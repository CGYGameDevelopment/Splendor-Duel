"""
GameState dict → flat float32 numpy array of shape (859,).

Layout (always from the current player's perspective):
  [0..199]    Board:          25 cells × 8  (one-hot: 7 token colors + empty)
  [200..206]  Bag:            7 token counts / _TOKEN_SCALE
  [207..518]  Pyramid:        12 card slots × 26 features  (level1: 5, level2: 4, level3: 3)
  [519..521]  Deck sizes:     3 values / _DECK_SCALE
  [522..625]  Royal deck:     4 card slots × 26 features
  [626]       Table privs:    count / _TABLE_PRIV_SCALE
  [627..734]  Current player: 108 features
  [735..842]  Opponent:       108 features
  [843..849]  Phase:          7 one-hot (all engine phases except game_over)
  [850]       reserved:       always 0 (was raw currentPlayer; removed to preserve
                              seat-symmetric perspective encoding)
  [851]       extraTurns:     / _EXTRA_TURNS_SCALE
  [852..858]  pendingAbility: 7 one-hot (6 abilities + none)

  TOTAL: 859

Per-card features (26):
  [0..6]   color one-hot (7): white/blue/green/red/black/wild/null
  [7]      absent bit (1.0 when this slot has no card)
  [8]      present bit (1.0 when this slot has a card)
  [9]      points / _POINTS_SCALE
  [10]     bonus / _BONUS_SCALE
  [11..16] ability one-hot (6 abilities: Turn, Token, Take, Privilege, wild, wild and turn)
  [17]     no-ability bit
  [18]     crowns / _CARD_CROWNS_SCALE
  [19..25] cost per token color / _COST_SCALE

Per-player features (108):
  [0..6]   tokens (7 colors) / _TOKEN_SCALE
  [7..11]  bonuses per gem color (5) / _BONUS_COLOR_SCALE
  [12..16] prestige per gem color (5) / _PRESTIGE_COLOR_SCALE
  [17]     total prestige / _TOTAL_PRESTIGE_SCALE
  [18]     crowns / _PLAYER_CROWNS_SCALE
  [19]     privileges / _PRIVILEGES_SCALE
  [20]     reserved card count / _RESERVED_SCALE
  [21..46] reserved card 0 (26 features)
  [47..72] reserved card 1 (26 features)
  [73..98] reserved card 2 (26 features)
  [99..107] royal cards: 9 floats (3 royals × 3 scalar features:
                                   points/_POINTS_SCALE, crowns/_CARD_CROWNS_SCALE, has_ability)

Vocabulary note: the JSON card data uses `color: null` and `ability: "wild" | "wild and turn"`
for wild jewel cards (not the `color: "wild"` / `ability: "Wild"` pattern suggested by
types.ts). The encoder matches what actually appears at runtime.
"""

from __future__ import annotations

import numpy as np

STATE_DIM = 859

TOKEN_COLORS = ["white", "blue", "green", "red", "black", "pearl", "gold"]
GEM_COLORS = ["white", "blue", "green", "red", "black"]
# CARD_COLORS matches the runtime `card.color` field:
#   - gem colors (5) directly from data
#   - "wild" slot set for wild jewel cards (data stores them as color=null, ability='wild'|'wild and turn')
#   - "null" slot set for non-gem, non-wild cards (royal cards)
# Position 7 in the per-card layout is the "absent" bit (slot has no card at all).
CARD_COLORS = ["white", "blue", "green", "red", "black", "wild", "null"]
# ABILITIES matches the runtime `card.ability` / `state.pendingAbility` strings.
# 'wild' and 'wild and turn' are the lowercase/spaced forms emitted by the JSON card data.
ABILITIES = ["Turn", "Token", "Take", "Privilege", "wild", "wild and turn"]
# Labels for wild-like abilities, used to detect wild jewel cards whose color field is null.
_WILD_ABILITIES = frozenset({"wild", "wild and turn"})
PHASES = [
    "optional_privilege",
    "optional_replenish",
    "mandatory",
    "choose_royal",
    "resolve_ability",
    "assign_wild",
    "discard",
    # "game_over" is intentionally excluded: its bit would only ever fire on the
    # terminal observation, whose value estimate is ignored by the RL bootstrap.
]

CARD_FEATURES = 26
PLAYER_FEATURES = 108

# Normalization divisors — adjust these if the game's numeric ranges change.
# Values chosen to cover theoretical game maxima, not just typical ranges, so
# the encoder never emits values > 1.0 (which would then be clamped and lose
# information).
_TOKEN_SCALE = 10.0          # token counts per color (max 4 gems / 2 pearl / 3 gold per pool)
_POINTS_SCALE = 6.0          # card point values (max 6 in data)
_BONUS_SCALE = 2.0           # card bonus values (max 2 in data)
_COST_SCALE = 8.0            # token cost per color (max 8 in data)
_CARD_CROWNS_SCALE = 3.0     # crowns on a card (max 3 in data)
_DECK_SCALE = 30.0           # cards remaining in a deck (max 25 at start)
_BONUS_COLOR_SCALE = 12.0    # purchased bonuses per gem color (theoretical max: 10×1 + 1×2 + 1 wild = 12)
_PRESTIGE_COLOR_SCALE = 14.0 # prestige earned per gem color (wins at 10, but overshoot possible up to ~14)
_TOTAL_PRESTIGE_SCALE = 26.0 # total prestige points (wins at 20, overshoot possible)
_PLAYER_CROWNS_SCALE = 13.0  # total crowns on a player (wins at 10, overshoot possible)
_PRIVILEGES_SCALE = 3.0      # privilege tokens (max 3)
_RESERVED_SCALE = 3.0        # reserved card count (max 3)
_EXTRA_TURNS_SCALE = 3.0     # extraTurns counter (reserved — engine uses repeatTurn bool, field absent)
_TABLE_PRIV_SCALE = 3.0      # table-level privilege count (max 3)


# ── Per-card encoding ─────────────────────────────────────────────────────────

def _encode_card(card: dict | None, out: np.ndarray, offset: int) -> None:
    """Write 26 floats for one card slot starting at out[offset]. Marks slot absent if None."""
    if card is None:
        out[offset + 7] = 1.0  # absent bit
        return

    # Color one-hot.  Gem colors come straight from the `color` field; wild jewel
    # cards have color=null in data so they are detected via their ability; all
    # other null-color cards (royal cards) use the "null" slot.
    color = card.get("color")
    ability = card.get("ability")
    if color in GEM_COLORS:
        out[offset + CARD_COLORS.index(color)] = 1.0
    elif ability in _WILD_ABILITIES:
        out[offset + CARD_COLORS.index("wild")] = 1.0
    else:
        out[offset + CARD_COLORS.index("null")] = 1.0

    out[offset + 8] = 1.0  # present bit
    out[offset + 9] = card.get("points", 0) / _POINTS_SCALE
    out[offset + 10] = card.get("bonus", 0) / _BONUS_SCALE

    if ability in ABILITIES:
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

    # Phase (7 one-hot slots, 843..849)
    phase = state.get("phase", "mandatory")
    if phase in PHASES:
        out[843 + PHASES.index(phase)] = 1.0

    # out[850] is intentionally left zero — encoding the raw seat index would
    # leak absolute player identity into an otherwise perspective-symmetric
    # observation.  The slot is kept so the layout stays aligned with the
    # docstring and so future uses have a natural home.
    out[851] = state.get("extraTurns", 0) / _EXTRA_TURNS_SCALE

    # Pending ability (852..858)
    pending = state.get("pendingAbility")
    if pending and pending in ABILITIES:
        out[852 + ABILITIES.index(pending)] = 1.0
    else:
        out[858] = 1.0  # none

    assert out.shape == (STATE_DIM,), f"State encoder output shape {out.shape} != ({STATE_DIM},)"
    # Detect out-of-range values caused by scale constants being too small for actual game values.
    # Clamp rather than assert so training can continue, but warn loudly on first occurrence per index.
    if (out > 1.05).any() or (out < 0.0).any():
        over_mask = out > 1.05
        under_mask = out < 0.0
        bad_indices = np.nonzero(over_mask | under_mask)[0]
        new_indices = [i for i in bad_indices.tolist() if i not in _warned_indices]
        if new_indices:
            _warned_indices.update(new_indices)
            import logging as _logging
            samples = ", ".join(
                f"[{i}]={out[i]:.3f} ({_describe_index(int(i))})" for i in new_indices[:6]
            )
            _logging.getLogger(__name__).warning(
                "state_encoder: %d new out-of-range indices (over=%d, under=%d). "
                "Samples: %s. Clamping to [0, 1].",
                len(new_indices), int(over_mask.sum()), int(under_mask.sum()), samples,
            )
        np.clip(out, 0.0, 1.0, out=out)
    return out


_warned_indices: set[int] = set()


def _describe_index(i: int) -> str:
    """Map a flat index to a human-readable feature name for diagnostics."""
    if i < 200:
        cell, slot = divmod(i, 8)
        return f"board[{cell}].{'color' if slot < 7 else 'empty'}[{slot}]"
    if i < 207:
        return f"bag.{TOKEN_COLORS[i - 200]}/_TOKEN_SCALE"
    if i < 519:
        rel = i - 207
        slot, field = divmod(rel, CARD_FEATURES)
        level = "L1" if slot < 5 else ("L2" if slot < 9 else "L3")
        return f"pyramid[{level}#{slot}].field[{field}]"
    if i < 522:
        return f"deck.level{i - 518}/_DECK_SCALE"
    if i < 626:
        rel = i - 522
        slot, field = divmod(rel, CARD_FEATURES)
        return f"royalDeck[{slot}].field[{field}]"
    if i == 626:
        return "table.privileges/_TABLE_PRIV_SCALE"
    if i < 735:
        return f"currentPlayer.field[{i - 627}]"
    if i < 843:
        return f"opponent.field[{i - 735}]"
    if i < 850:
        return f"phase[{PHASES[i - 843]}]"
    if i == 850:
        return "reserved"
    if i == 851:
        return "extraTurns/_EXTRA_TURNS_SCALE"
    if i < 858:
        return f"pendingAbility[{ABILITIES[i - 852]}]"
    return "pendingAbility[none]"
