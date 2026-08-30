"""
GameState dict -> flat float32 numpy array of shape (STATE_DIM,).

Design notes
------------
Categorical fields (card colour, card ability, phase, pending ability, board
cell contents) are **one-hot** encoded.  An earlier revision encoded them as a
single normalised scalar (color_index / 6), which asserted a false ordering:
it told the network that blue sits "between" white and green.  Colours are the
entire economy of this game and have no ordinal relationship, so the net had to
spend capacity carving a 1-D line into bins before it could represent "this
card costs blue".

The 5x5 token board is encoded in full.  It was previously omitted entirely on
the theory that the aggregate bag counts were sufficient; they are not.  54% of
the action space (145 TAKE_TOKENS lines, 25 USE_PRIVILEGE cells, 25
TAKE_TOKEN_FROM_BOARD) addresses individual board cells, and without the board
the policy chooses among them blind.

Board indices are row-major (index = row * 5 + col), matching board.ts's
indexToCoord.  The spiral in SPIRAL_ORDER is only the refill order, not the
array order.

Layout offsets are exported so model.py can slice the observation without
duplicating magic numbers.

Layout (always from the current player's perspective):
  [0..199]    Board:          25 cells x 8 one-hot (7 token colours + empty)
  [200..206]  Bag:            7 token counts / token scale
  [207..494]  Pyramid:        12 card slots x 24 features (level1: 5, level2: 4, level3: 3)
  [495..497]  Deck sizes:     3 values / deck scale
  [498..505]  Royal deck:     4 card slots x 2 features (prestige, has_ability)
  [506]       Table privs:    count / table priv scale
  [507..605]  Current player: 99 features
  [606..704]  Opponent:       99 features
  [705..711]  Phase:          7 one-hot
  [712]       extraTurns:     / extra turns scale
  [713..718]  pendingAbility: 6 one-hot (all-zero = none)

  TOTAL: 719

Per-card features (24):
  [0]      present (1.0 when slot has a card, 0.0 when empty)
  [1..7]   colour one-hot (CARD_COLORS: white, blue, green, red, black, wild, null)
  [8]      points / points scale
  [9]      bonus / bonus scale
  [10..15] ability one-hot (ABILITIES); all-zero = no ability
  [16]     crowns / card crowns scale
  [17..23] cost per token colour / cost scale (TOKEN_COLORS order)

Per-royal-card features (2):
  [0]      prestige / points scale
  [1]      has_ability (1.0 if card has an ability, else 0.0)

Per-player features (99):
  [0..6]   tokens (7 colours) / token scale
  [7..11]  bonuses per gem colour (5) / bonus colour scale
  [12..16] prestige per gem colour (5) / prestige colour scale
  [17]     total prestige / total prestige scale
  [18]     crowns / player crowns scale
  [19]     privileges / privileges scale
  [20]     reserved card count / reserved scale
  [21..92] reserved cards: 3 x 24
  [93..98] royal cards: 3 x 2 scalar features (prestige, has_ability)

Vocabulary note: the JSON card data uses a null color and an ability of
"wild" / "wild and turn" for wild jewel cards (not the color="wild" /
ability="Wild" pattern suggested by types.ts).  The encoder matches what
actually appears at runtime.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

TOKEN_COLORS = ["white", "blue", "green", "red", "black", "pearl", "gold"]
GEM_COLORS = ["white", "blue", "green", "red", "black"]
# CARD_COLORS matches the runtime card.color field:
#   - gem colours (5) directly from data
#   - "wild" for wild jewel cards (data stores them as color=null, ability='wild'|'wild and turn')
#   - "null" for non-gem, non-wild cards (royal cards)
CARD_COLORS = ["white", "blue", "green", "red", "black", "wild", "null"]
# ABILITIES matches the runtime card.ability / state.pendingAbility strings.
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

# -- Sub-structure sizes -------------------------------------------------------

N_BOARD_CELLS = 25
BOARD_CELL_FEATURES = len(TOKEN_COLORS) + 1   # 7 colours + "empty" = 8
CARD_FEATURES = 1 + len(CARD_COLORS) + 2 + len(ABILITIES) + 1 + len(TOKEN_COLORS)  # 24
ROYAL_FEATURES = 2
N_PYRAMID = 12
N_L1, N_L2, N_L3 = 5, 4, 3
N_RESERVED = 3
N_PLAYER_ROYALS = 3
N_PHASES = len(PHASES)
N_ABILITIES = len(ABILITIES)

# -- Visible card slots --------------------------------------------------------
# Slot order used by encode_card_ids() and by the model's card pointer head:
#   [0..11]  pyramid  (L1 x5, L2 x4, L3 x3)
#   [12..14] current player's reserved cards
#   [15..17] opponent's reserved cards
# Purchase is legal from pyramid or the player's OWN reserved cards, so slots
# [0..14] can carry a purchase logit; reserve-from-pyramid only applies to
# [0..11].  Opponent reserved slots are features only.
N_PYRAMID_SLOTS = N_PYRAMID                                  # 12
N_CARD_SLOTS = N_PYRAMID_SLOTS + 2 * N_RESERVED              # 18
N_PURCHASABLE_SLOTS = N_PYRAMID_SLOTS + N_RESERVED           # 15
MAX_CARD_ID = 67

# -- Per-card field offsets ----------------------------------------------------

C_PRESENT = 0
C_COLOR = 1                              # 1..7
C_POINTS = C_COLOR + len(CARD_COLORS)    # 8
C_BONUS = C_POINTS + 1                   # 9
C_ABILITY = C_BONUS + 1                  # 10..15
C_CROWNS = C_ABILITY + len(ABILITIES)    # 16
C_COST = C_CROWNS + 1                    # 17..23

# -- Per-player sub-layout -----------------------------------------------------

P_TOKENS = 0
P_BONUSES = 7
P_PRESTIGE_COLOR = 12
P_TOTAL_PRESTIGE = 17
P_CROWNS = 18
P_PRIVILEGES = 19
P_RESERVED_COUNT = 20
P_SCALAR_END = 21                                                # end of scalar block
P_RESERVED_START = P_SCALAR_END                                  # 21
P_RESERVED_END = P_RESERVED_START + N_RESERVED * CARD_FEATURES   # 93
P_ROYAL_START = P_RESERVED_END                                   # 93
PLAYER_FEATURES = P_ROYAL_START + N_PLAYER_ROYALS * ROYAL_FEATURES  # 99

# -- Top-level layout ----------------------------------------------------------

BOARD_START = 0
BOARD_END = BOARD_START + N_BOARD_CELLS * BOARD_CELL_FEATURES   # 200
BAG_START = BOARD_END                                           # 200
BAG_END = BAG_START + len(TOKEN_COLORS)                         # 207
PYRAMID_START = BAG_END                                         # 207
PYRAMID_END = PYRAMID_START + N_PYRAMID * CARD_FEATURES         # 495
DECK_START = PYRAMID_END                                        # 495
DECK_END = DECK_START + 3                                       # 498
ROYAL_START = DECK_END                                          # 498
ROYAL_END = ROYAL_START + 4 * ROYAL_FEATURES                    # 506
TABLE_PRIV = ROYAL_END                                          # 506
CUR_START = TABLE_PRIV + 1                                      # 507
CUR_END = CUR_START + PLAYER_FEATURES                           # 606
OPP_START = CUR_END                                             # 606
OPP_END = OPP_START + PLAYER_FEATURES                           # 705
PHASE_START = OPP_END                                           # 705
PHASE_END = PHASE_START + N_PHASES                              # 712
EXTRA_TURNS = PHASE_END                                         # 712
PENDING_START = EXTRA_TURNS + 1                                 # 713
PENDING_END = PENDING_START + N_ABILITIES                       # 719

STATE_DIM = PENDING_END                                         # 719

# Precomputed index lookups for O(1) categorical encoding.
_CARD_COLOR_IDX: dict[str, int] = {c: i for i, c in enumerate(CARD_COLORS)}
_ABILITY_IDX: dict[str, int] = {a: i for i, a in enumerate(ABILITIES)}
_PHASE_IDX: dict[str, int] = {p: i for i, p in enumerate(PHASES)}
_GEM_IDX: dict[str, int] = {c: i for i, c in enumerate(GEM_COLORS)}
_TOKEN_IDX: dict[str, int] = {c: i for i, c in enumerate(TOKEN_COLORS)}
# Board cells hold a TokenColor or null; null maps to the trailing "empty" slot.
_BOARD_CELL_IDX: dict[str, int] = dict(_TOKEN_IDX)
_BOARD_EMPTY_IDX = len(TOKEN_COLORS)


@dataclass
class EncoderScales:
    """
    Normalization divisors for the continuous features of the state encoder.

    Values default to theoretical game maxima so the encoder never emits values
    above 1.0 under normal play.  Override individual fields to accommodate
    rule variants or to fix out-of-range warnings without editing source code.
    """
    token: float = 10.0           # token counts per colour (max 4 gems / 2 pearl / 3 gold per pool)
    points: float = 6.0           # card point values (max 6 in data)
    bonus: float = 2.0            # card bonus values (max 2 in data)
    cost: float = 8.0             # token cost per colour (max 8 in data)
    card_crowns: float = 3.0      # crowns on a card (max 3 in data)
    deck: float = 30.0            # cards remaining in a deck (max 25 at start)
    bonus_color: float = 12.0     # purchased bonuses per gem colour (theoretical max ~12)
    prestige_color: float = 14.0  # prestige per gem colour (wins at 10, overshoot possible)
    total_prestige: float = 26.0  # total prestige (wins at 20, overshoot possible)
    player_crowns: float = 13.0   # total crowns on a player (wins at 10, overshoot possible)
    privileges: float = 3.0       # privilege tokens (max 3)
    reserved: float = 3.0         # reserved card count (max 3)
    extra_turns: float = 3.0      # extraTurns counter (reserved field)
    table_priv: float = 3.0       # table-level privilege count (max 3)


DEFAULT_SCALES = EncoderScales()


# -- Per-card encoding ---------------------------------------------------------

def _encode_card(card: dict | None, out: np.ndarray, offset: int, scales: EncoderScales) -> None:
    """Write CARD_FEATURES floats for one card slot at out[offset]. Empty slot stays all-zero."""
    if card is None:
        return  # present=0 signals absence; all other fields zero by default

    out[offset + C_PRESENT] = 1.0

    color = card.get("color")
    ability = card.get("ability")
    if color in _GEM_IDX:
        color_key = color
    elif ability in _WILD_ABILITIES:
        color_key = "wild"
    else:
        color_key = "null"
    out[offset + C_COLOR + _CARD_COLOR_IDX[color_key]] = 1.0

    out[offset + C_POINTS] = card.get("points", 0) / scales.points
    out[offset + C_BONUS] = card.get("bonus", 0) / scales.bonus

    ability_idx = _ABILITY_IDX.get(ability)
    if ability_idx is not None:
        out[offset + C_ABILITY + ability_idx] = 1.0
    # else: all-zero ability block = no ability

    out[offset + C_CROWNS] = card.get("crowns", 0) / scales.card_crowns

    cost = card.get("cost", {})
    for ci, color_name in enumerate(TOKEN_COLORS):
        out[offset + C_COST + ci] = cost.get(color_name, 0) / scales.cost


# -- Per-player encoding -------------------------------------------------------

def _encode_player(player: dict, out: np.ndarray, offset: int, scales: EncoderScales) -> None:
    """Write PLAYER_FEATURES floats for one player starting at out[offset]."""
    tokens = player.get("tokens", {})
    for color, ci in _TOKEN_IDX.items():
        out[offset + P_TOKENS + ci] = tokens.get(color, 0) / scales.token

    purchased = player.get("purchasedCards", [])
    bonuses = np.zeros(5, dtype=np.float32)
    prestige_by_color = np.zeros(5, dtype=np.float32)
    for card in purchased:
        effective_color = card.get("assignedColor") or card.get("color")
        ci = _GEM_IDX.get(effective_color)
        if ci is not None:
            bonuses[ci] += card.get("bonus", 0)
            prestige_by_color[ci] += card.get("points", 0)

    out[offset + P_BONUSES : offset + P_BONUSES + 5] = bonuses / scales.bonus_color
    out[offset + P_PRESTIGE_COLOR : offset + P_PRESTIGE_COLOR + 5] = (
        prestige_by_color / scales.prestige_color
    )

    out[offset + P_TOTAL_PRESTIGE] = player.get("prestige", 0) / scales.total_prestige
    out[offset + P_CROWNS] = player.get("crowns", 0) / scales.player_crowns
    out[offset + P_PRIVILEGES] = player.get("privileges", 0) / scales.privileges

    reserved = player.get("reservedCards", [])
    out[offset + P_RESERVED_COUNT] = len(reserved) / scales.reserved
    for i in range(N_RESERVED):
        card = reserved[i] if i < len(reserved) else None
        _encode_card(card, out, offset + P_RESERVED_START + i * CARD_FEATURES, scales)

    royal_base = offset + P_ROYAL_START
    royals = player.get("royalCards", [])
    for i in range(N_PLAYER_ROYALS):
        if i < len(royals):
            r = royals[i]
            base = royal_base + i * ROYAL_FEATURES
            out[base] = r.get("points", 0) / scales.points
            out[base + 1] = 1.0 if r.get("ability") is not None else 0.0


# -- Main encode function ------------------------------------------------------

_warned_indices: set[int] = set()


def encode(state: dict, scales: EncoderScales | None = None) -> np.ndarray:
    """Encode a GameState dict into a float32 array of shape (STATE_DIM,)."""
    if scales is None:
        scales = DEFAULT_SCALES
    out = np.zeros(STATE_DIM, dtype=np.float32)
    current_player_idx: int = state.get("currentPlayer", 0)

    # Board [0:200] -- 25 cells x 8 one-hot.  A cell holding no token (null) sets
    # the trailing "empty" slot, so every cell contributes exactly one 1.0.
    board = state.get("board", [])
    for cell_idx in range(N_BOARD_CELLS):
        cell = board[cell_idx] if cell_idx < len(board) else None
        slot = _BOARD_CELL_IDX.get(cell, _BOARD_EMPTY_IDX)
        out[BOARD_START + cell_idx * BOARD_CELL_FEATURES + slot] = 1.0

    # Bag [200:207]
    bag = state.get("bag", {})
    for ci, color in enumerate(TOKEN_COLORS):
        out[BAG_START + ci] = bag.get(color, 0) / scales.token

    # Pyramid [207:495] -- 12 card slots x CARD_FEATURES
    pyramid = state.get("pyramid", {})
    slot = 0
    for level_key in ("level1", "level2", "level3"):
        for card in pyramid.get(level_key, []):
            _encode_card(card, out, PYRAMID_START + slot * CARD_FEATURES, scales)
            slot += 1

    # Deck sizes [495:498].  The compact wire format from the sim server sends
    # deckCounts instead of the full card arrays -- the encoder only ever needed
    # the counts, and the arrays were 72% of every response payload.
    counts = state.get("deckCounts")
    if counts is None:
        decks = state.get("decks", {})
        counts = {k: len(decks.get(k, [])) for k in ("level1", "level2", "level3")}
    out[DECK_START] = counts.get("level1", 0) / scales.deck
    out[DECK_START + 1] = counts.get("level2", 0) / scales.deck
    out[DECK_START + 2] = counts.get("level3", 0) / scales.deck

    # Royal deck [498:506] -- 4 slots x 2 features
    royal_deck = state.get("royalDeck", [])
    for i, card in enumerate(royal_deck[:4]):
        base = ROYAL_START + i * ROYAL_FEATURES
        out[base] = card.get("points", 0) / scales.points
        out[base + 1] = 1.0 if card.get("ability") is not None else 0.0

    # Table privileges [506]
    out[TABLE_PRIV] = state.get("privileges", 0) / scales.table_priv

    # Players [507:705] -- always encode current player first
    players = state.get("players", [{}, {}])
    opponent_idx = 1 - current_player_idx
    _encode_player(players[current_player_idx], out, CUR_START, scales)
    _encode_player(players[opponent_idx], out, OPP_START, scales)

    # Phase [705:712] -- one-hot; unknown / game_over stays all-zero
    phase_idx = _PHASE_IDX.get(state.get("phase", "mandatory"))
    if phase_idx is not None:
        out[PHASE_START + phase_idx] = 1.0

    out[EXTRA_TURNS] = state.get("extraTurns", 0) / scales.extra_turns

    # Pending ability [713:719] -- one-hot; all-zero = none
    pending_idx = _ABILITY_IDX.get(state.get("pendingAbility"))
    if pending_idx is not None:
        out[PENDING_START + pending_idx] = 1.0

    assert out.shape == (STATE_DIM,), f"State encoder output shape {out.shape} != ({STATE_DIM},)"
    if (out > 1.05).any() or (out < 0.0).any():
        over_mask = out > 1.05
        under_mask = out < 0.0
        bad_indices = np.nonzero(over_mask | under_mask)[0]
        new_indices = [i for i in bad_indices.tolist() if i not in _warned_indices]
        if new_indices:
            _warned_indices.update(new_indices)
            samples = ", ".join(
                f"[{i}]={out[i]:.3f} ({describe_index(int(i))})" for i in new_indices[:6]
            )
            logging.getLogger(__name__).warning(
                "state_encoder: %d new out-of-range indices (over=%d, under=%d). "
                "Samples: %s. Clamping to [0, 1].",
                len(new_indices), int(over_mask.sum()), int(under_mask.sum()), samples,
            )
        np.clip(out, 0.0, 1.0, out=out)
    return out


def encode_card_ids(state: dict) -> np.ndarray:
    """
    Card id occupying each visible card slot, or 0 for an empty slot.

    Returned in the slot order documented at N_CARD_SLOTS.  The model's card
    pointer head uses these to route a per-card logit to that card's position in
    the action space, so "should I buy this card" becomes one shared function of
    the card's features rather than 134 independently-learned output rows.
    """
    ids = np.zeros(N_CARD_SLOTS, dtype=np.int64)

    pyramid = state.get("pyramid", {})
    slot = 0
    for level_key in ("level1", "level2", "level3"):
        for card in pyramid.get(level_key, []):
            if slot >= N_PYRAMID_SLOTS:
                break
            if card is not None:
                ids[slot] = card.get("id", 0)
            slot += 1

    current_player_idx: int = state.get("currentPlayer", 0)
    players = state.get("players", [{}, {}])
    for offset, player_idx in (
        (N_PYRAMID_SLOTS, current_player_idx),
        (N_PYRAMID_SLOTS + N_RESERVED, 1 - current_player_idx),
    ):
        reserved = players[player_idx].get("reservedCards", [])
        for i in range(N_RESERVED):
            if i < len(reserved) and reserved[i] is not None:
                ids[offset + i] = reserved[i].get("id", 0)

    return ids


# -- Diagnostics ---------------------------------------------------------------

def _describe_card_field(field: int) -> str:
    if field == C_PRESENT:
        return "present"
    if C_COLOR <= field < C_POINTS:
        return f"color[{CARD_COLORS[field - C_COLOR]}]"
    if field == C_POINTS:
        return "points"
    if field == C_BONUS:
        return "bonus"
    if C_ABILITY <= field < C_CROWNS:
        return f"ability[{ABILITIES[field - C_ABILITY]}]"
    if field == C_CROWNS:
        return "crowns"
    return f"cost[{TOKEN_COLORS[field - C_COST]}]"


def _describe_player_field(field: int) -> str:
    if field < P_BONUSES:
        return f"tokens[{TOKEN_COLORS[field]}]"
    if field < P_PRESTIGE_COLOR:
        return f"bonus[{GEM_COLORS[field - P_BONUSES]}]"
    if field < P_TOTAL_PRESTIGE:
        return f"prestige[{GEM_COLORS[field - P_PRESTIGE_COLOR]}]"
    if field == P_TOTAL_PRESTIGE:
        return "total_prestige"
    if field == P_CROWNS:
        return "crowns"
    if field == P_PRIVILEGES:
        return "privileges"
    if field == P_RESERVED_COUNT:
        return "reserved_count"
    if field < P_ROYAL_START:
        slot, sub = divmod(field - P_RESERVED_START, CARD_FEATURES)
        return f"reserved[{slot}].{_describe_card_field(sub)}"
    slot, sub = divmod(field - P_ROYAL_START, ROYAL_FEATURES)
    return f"royal[{slot}].{'prestige' if sub == 0 else 'has_ability'}"


def describe_index(i: int) -> str:
    """Map a flat observation index to a human-readable feature name for diagnostics."""
    if i < BOARD_END:
        cell, slot = divmod(i - BOARD_START, BOARD_CELL_FEATURES)
        name = "empty" if slot == _BOARD_EMPTY_IDX else TOKEN_COLORS[slot]
        return f"board[{cell} @ r{cell // 5}c{cell % 5}].{name}"
    if i < BAG_END:
        return f"bag.{TOKEN_COLORS[i - BAG_START]}"
    if i < PYRAMID_END:
        slot, field = divmod(i - PYRAMID_START, CARD_FEATURES)
        level = "L1" if slot < N_L1 else ("L2" if slot < N_L1 + N_L2 else "L3")
        return f"pyramid[{level}#{slot}].{_describe_card_field(field)}"
    if i < DECK_END:
        return f"deck.level{i - DECK_START + 1}"
    if i < ROYAL_END:
        slot, field = divmod(i - ROYAL_START, ROYAL_FEATURES)
        return f"royalDeck[{slot}].{'prestige' if field == 0 else 'has_ability'}"
    if i == TABLE_PRIV:
        return "table.privileges"
    if i < CUR_END:
        return f"currentPlayer.{_describe_player_field(i - CUR_START)}"
    if i < OPP_END:
        return f"opponent.{_describe_player_field(i - OPP_START)}"
    if i < PHASE_END:
        return f"phase[{PHASES[i - PHASE_START]}]"
    if i == EXTRA_TURNS:
        return "extraTurns"
    if i < PENDING_END:
        return f"pendingAbility[{ABILITIES[i - PENDING_START]}]"
    return f"out_of_range[{i}]"
