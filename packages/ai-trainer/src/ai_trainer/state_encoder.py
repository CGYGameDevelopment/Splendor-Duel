"""
GameState dict → flat float32 numpy array of shape (311,).

Pass a custom EncoderScales instance to encode() to adjust normalization divisors
without modifying source code (e.g. to fix out-of-range warnings for a rule variant).

Layout (always from the current player's perspective):
  [0..6]    Bag:            7 token counts / _TOKEN_SCALE
  [7..162]  Pyramid:        12 card slots × 13 features  (level1: 5, level2: 4, level3: 3)
  [163..165] Deck sizes:    3 values / _DECK_SCALE
  [166..173] Royal deck:    4 card slots × 2 features (prestige, has_ability)
  [174]     Table privs:    count / _TABLE_PRIV_SCALE
  [175..240] Current player: 66 features
  [241..306] Opponent:      66 features
  [307]     Phase:          index / (len-1), normalized to [0, 1]
  [308]     reserved:       always 0 (seat-symmetric encoding — never encodes raw player index)
  [309]     extraTurns:     / _EXTRA_TURNS_SCALE
  [310]     pendingAbility: 0=none, (idx+1)/6 for each of 6 abilities

  TOTAL: 311

Per-card features (13):
  [0]    present (1.0 when slot has a card, 0.0 when empty)
  [1]    color index / 6  (CARD_COLORS order: white=0..null=6)
  [2]    points / _POINTS_SCALE
  [3]    bonus / _BONUS_SCALE
  [4]    ability index: 0.0=none, (ABILITIES.index+1)/6 for each ability
  [5]    crowns / _CARD_CROWNS_SCALE
  [6..12] cost per token color / _COST_SCALE  (TOKEN_COLORS order)

Per-royal-card features (2):
  [0]    prestige / _POINTS_SCALE
  [1]    has_ability (1.0 if card has an ability, else 0.0)

Per-player features (66):
  [0..6]   tokens (7 colors) / _TOKEN_SCALE
  [7..11]  bonuses per gem color (5) / _BONUS_COLOR_SCALE
  [12..16] prestige per gem color (5) / _PRESTIGE_COLOR_SCALE
  [17]     total prestige / _TOTAL_PRESTIGE_SCALE
  [18]     crowns / _PLAYER_CROWNS_SCALE
  [19]     privileges / _PRIVILEGES_SCALE
  [20]     reserved card count / _RESERVED_SCALE
  [21..33] reserved card 0 (13 features)
  [34..46] reserved card 1 (13 features)
  [47..59] reserved card 2 (13 features)
  [60..65] royal cards: 6 floats (3 royals × 2 scalar features: prestige, has_ability)

Vocabulary note: the JSON card data uses `color: null` and `ability: "wild" | "wild and turn"`
for wild jewel cards (not the `color: "wild"` / `ability: "Wild"` pattern suggested by
types.ts). The encoder matches what actually appears at runtime.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

STATE_DIM = 311

TOKEN_COLORS = ["white", "blue", "green", "red", "black", "pearl", "gold"]
GEM_COLORS = ["white", "blue", "green", "red", "black"]
# CARD_COLORS matches the runtime `card.color` field:
#   - gem colors (5) directly from data
#   - "wild" for wild jewel cards (data stores them as color=null, ability='wild'|'wild and turn')
#   - "null" for non-gem, non-wild cards (royal cards)
CARD_COLORS = ["white", "blue", "green", "red", "black", "wild", "null"]
# ABILITIES matches the runtime `card.ability` / `state.pendingAbility` strings.
ABILITIES = ["Turn", "Token", "Take", "Privilege", "wild", "wild and turn"]
_WILD_ABILITIES = frozenset({"wild", "wild and turn"})
PHASES = [
    "optional_privilege",
    "optional_replenish",
    "mandatory",
    "choose_royal",
    "resolve_ability",
    "assign_wild",
    "discard",
    # "game_over" excluded: terminal observation value is never bootstrapped.
]

CARD_FEATURES = 13
ROYAL_FEATURES = 2
PLAYER_FEATURES = 66

# Precomputed index lookups for O(1) categorical encoding.
_COLOR_IDX: dict[str, float] = {c: i / (len(CARD_COLORS) - 1) for i, c in enumerate(CARD_COLORS)}
_ABILITY_IDX: dict[str, float] = {a: (i + 1) / len(ABILITIES) for i, a in enumerate(ABILITIES)}
_PHASE_IDX: dict[str, float] = {p: i / (len(PHASES) - 1) for i, p in enumerate(PHASES)}
_GEM_IDX: dict[str, int] = {c: i for i, c in enumerate(GEM_COLORS)}
_TOKEN_IDX: dict[str, int] = {c: i for i, c in enumerate(TOKEN_COLORS)}


@dataclass
class EncoderScales:
    """
    Normalization divisors for the state encoder.

    Values default to theoretical game maxima so the encoder never emits values
    above 1.0 under normal play.  Override individual fields to accommodate
    rule variants or to fix out-of-range warnings without editing source code.
    """
    token: float = 10.0           # token counts per color (max 4 gems / 2 pearl / 3 gold per pool)
    points: float = 6.0           # card point values (max 6 in data)
    bonus: float = 2.0            # card bonus values (max 2 in data)
    cost: float = 8.0             # token cost per color (max 8 in data)
    card_crowns: float = 3.0      # crowns on a card (max 3 in data)
    deck: float = 30.0            # cards remaining in a deck (max 25 at start)
    bonus_color: float = 12.0     # purchased bonuses per gem color (theoretical max ~12)
    prestige_color: float = 14.0  # prestige per gem color (wins at 10, overshoot possible)
    total_prestige: float = 26.0  # total prestige (wins at 20, overshoot possible)
    player_crowns: float = 13.0   # total crowns on a player (wins at 10, overshoot possible)
    privileges: float = 3.0       # privilege tokens (max 3)
    reserved: float = 3.0         # reserved card count (max 3)
    extra_turns: float = 3.0      # extraTurns counter (reserved field)
    table_priv: float = 3.0       # table-level privilege count (max 3)


DEFAULT_SCALES = EncoderScales()

# Module-level aliases kept for backwards compatibility.
_TOKEN_SCALE = DEFAULT_SCALES.token
_POINTS_SCALE = DEFAULT_SCALES.points
_BONUS_SCALE = DEFAULT_SCALES.bonus
_COST_SCALE = DEFAULT_SCALES.cost
_CARD_CROWNS_SCALE = DEFAULT_SCALES.card_crowns
_DECK_SCALE = DEFAULT_SCALES.deck
_BONUS_COLOR_SCALE = DEFAULT_SCALES.bonus_color
_PRESTIGE_COLOR_SCALE = DEFAULT_SCALES.prestige_color
_TOTAL_PRESTIGE_SCALE = DEFAULT_SCALES.total_prestige
_PLAYER_CROWNS_SCALE = DEFAULT_SCALES.player_crowns
_PRIVILEGES_SCALE = DEFAULT_SCALES.privileges
_RESERVED_SCALE = DEFAULT_SCALES.reserved
_EXTRA_TURNS_SCALE = DEFAULT_SCALES.extra_turns
_TABLE_PRIV_SCALE = DEFAULT_SCALES.table_priv


# ── Per-card encoding ─────────────────────────────────────────────────────────

def _encode_card(card: dict | None, out: np.ndarray, offset: int, scales: EncoderScales) -> None:
    """Write 13 floats for one card slot starting at out[offset]. Empty slot stays all-zero."""
    if card is None:
        return  # present=0 signals absence; all other fields zero by default

    out[offset] = 1.0  # present

    color = card.get("color")
    ability = card.get("ability")
    if color in _GEM_IDX:
        out[offset + 1] = _COLOR_IDX[color]
    elif ability in _WILD_ABILITIES:
        out[offset + 1] = _COLOR_IDX["wild"]
    else:
        out[offset + 1] = _COLOR_IDX["null"]

    out[offset + 2] = card.get("points", 0) / scales.points
    out[offset + 3] = card.get("bonus", 0) / scales.bonus
    if ability in _ABILITY_IDX:
        out[offset + 4] = _ABILITY_IDX[ability]
    # else: 0.0 = no ability (already zero)
    out[offset + 5] = card.get("crowns", 0) / scales.card_crowns

    cost = card.get("cost", {})
    for ci, color_name in enumerate(TOKEN_COLORS):
        out[offset + 6 + ci] = cost.get(color_name, 0) / scales.cost


# ── Per-player encoding ───────────────────────────────────────────────────────

def _encode_player(player: dict, out: np.ndarray, offset: int, scales: EncoderScales) -> None:
    """Write 66 floats for one player starting at out[offset]."""
    tokens = player.get("tokens", {})
    for color, ci in _TOKEN_IDX.items():
        out[offset + ci] = tokens.get(color, 0) / scales.token

    purchased = player.get("purchasedCards", [])
    bonuses = np.zeros(5, dtype=np.float32)
    prestige_by_color = np.zeros(5, dtype=np.float32)
    for card in purchased:
        effective_color = card.get("assignedColor") or card.get("color")
        ci = _GEM_IDX.get(effective_color)
        if ci is not None:
            bonuses[ci] += card.get("bonus", 0)
            prestige_by_color[ci] += card.get("points", 0)

    out[offset + 7 : offset + 12] = bonuses / scales.bonus_color
    out[offset + 12 : offset + 17] = prestige_by_color / scales.prestige_color

    out[offset + 17] = player.get("prestige", 0) / scales.total_prestige
    out[offset + 18] = player.get("crowns", 0) / scales.player_crowns
    out[offset + 19] = player.get("privileges", 0) / scales.privileges

    reserved = player.get("reservedCards", [])
    out[offset + 20] = len(reserved) / scales.reserved
    for i in range(3):
        card = reserved[i] if i < len(reserved) else None
        _encode_card(card, out, offset + 21 + i * CARD_FEATURES, scales)

    # Royal cards: 2 features each (prestige, has_ability)
    # Royal slot starts at 21 + 3×CARD_FEATURES = 21 + 39 = 60
    royal_base = offset + 21 + 3 * CARD_FEATURES
    royals = player.get("royalCards", [])
    for i in range(3):
        if i < len(royals):
            r = royals[i]
            base = royal_base + i * ROYAL_FEATURES
            out[base] = r.get("points", 0) / scales.points
            out[base + 1] = 1.0 if r.get("ability") is not None else 0.0


# ── Main encode function ──────────────────────────────────────────────────────

_warned_indices: set[int] = set()


def encode(state: dict, scales: EncoderScales | None = None) -> np.ndarray:
    """Encode a GameState dict into a float32 array of shape (311,)."""
    if scales is None:
        scales = DEFAULT_SCALES
    out = np.zeros(STATE_DIM, dtype=np.float32)
    current_player_idx: int = state.get("currentPlayer", 0)

    # Bag [0:7]
    bag = state.get("bag", {})
    for ci, color in enumerate(TOKEN_COLORS):
        out[ci] = bag.get(color, 0) / scales.token

    # Pyramid [7:163] — 12 card slots × 13 features
    pyramid = state.get("pyramid", {})
    slot = 0
    for level_key in ("level1", "level2", "level3"):
        for card in pyramid.get(level_key, []):
            _encode_card(card, out, 7 + slot * CARD_FEATURES, scales)
            slot += 1

    # Deck sizes [163:166]
    decks = state.get("decks", {})
    out[163] = len(decks.get("level1", [])) / scales.deck
    out[164] = len(decks.get("level2", [])) / scales.deck
    out[165] = len(decks.get("level3", [])) / scales.deck

    # Royal deck [166:174] — 4 slots × 2 features
    royal_deck = state.get("royalDeck", [])
    for i, card in enumerate(royal_deck[:4]):
        base = 166 + i * ROYAL_FEATURES
        out[base] = card.get("points", 0) / scales.points
        out[base + 1] = 1.0 if card.get("ability") is not None else 0.0

    # Table privileges [174]
    out[174] = state.get("privileges", 0) / scales.table_priv

    # Players [175:307] — always encode current player first
    players = state.get("players", [{}, {}])
    opponent_idx = 1 - current_player_idx
    _encode_player(players[current_player_idx], out, 175, scales)
    _encode_player(players[opponent_idx], out, 241, scales)

    # Phase [307] — normalized index; unknown phase stays 0.0
    phase = state.get("phase", "mandatory")
    if phase in _PHASE_IDX:
        out[307] = _PHASE_IDX[phase]

    # out[308] is intentionally left zero — encoding the raw seat index would
    # leak absolute player identity into an otherwise perspective-symmetric
    # observation.
    out[309] = state.get("extraTurns", 0) / scales.extra_turns

    # Pending ability [310] — 0.0=none, (idx+1)/6 for each ability
    pending = state.get("pendingAbility")
    if pending in _ABILITY_IDX:
        out[310] = _ABILITY_IDX[pending]

    assert out.shape == (STATE_DIM,), f"State encoder output shape {out.shape} != ({STATE_DIM},)"
    if (out > 1.05).any() or (out < 0.0).any():
        over_mask = out > 1.05
        under_mask = out < 0.0
        bad_indices = np.nonzero(over_mask | under_mask)[0]
        new_indices = [i for i in bad_indices.tolist() if i not in _warned_indices]
        if new_indices:
            _warned_indices.update(new_indices)
            samples = ", ".join(
                f"[{i}]={out[i]:.3f} ({_describe_index(int(i))})" for i in new_indices[:6]
            )
            logging.getLogger(__name__).warning(
                "state_encoder: %d new out-of-range indices (over=%d, under=%d). "
                "Samples: %s. Clamping to [0, 1].",
                len(new_indices), int(over_mask.sum()), int(under_mask.sum()), samples,
            )
        np.clip(out, 0.0, 1.0, out=out)
    return out


_CARD_FIELD_NAMES = [
    "present", "color_idx", "points", "bonus", "ability_idx", "crowns",
    "cost_white", "cost_blue", "cost_green", "cost_red", "cost_black", "cost_pearl", "cost_gold",
]


def _describe_index(i: int) -> str:
    """Map a flat index to a human-readable feature name for diagnostics."""
    if i < 7:
        return f"bag.{TOKEN_COLORS[i]}/_TOKEN_SCALE"
    if i < 163:
        rel = i - 7
        slot, field = divmod(rel, CARD_FEATURES)
        level = "L1" if slot < 5 else ("L2" if slot < 9 else "L3")
        return f"pyramid[{level}#{slot}].{_CARD_FIELD_NAMES[field]}"
    if i < 166:
        return f"deck.level{i - 162}/_DECK_SCALE"
    if i < 174:
        rel = i - 166
        slot, field = divmod(rel, ROYAL_FEATURES)
        return f"royalDeck[{slot}].{'prestige' if field == 0 else 'has_ability'}"
    if i == 174:
        return "table.privileges/_TABLE_PRIV_SCALE"
    if i < 241:
        return f"currentPlayer.field[{i - 175}]"
    if i < 307:
        return f"opponent.field[{i - 241}]"
    if i == 307:
        return "phase_idx"
    if i == 308:
        return "reserved"
    if i == 309:
        return "extraTurns/_EXTRA_TURNS_SCALE"
    if i == 310:
        return "pendingAbility_idx"
    return f"out_of_range[{i}]"
