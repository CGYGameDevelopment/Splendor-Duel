"""
Rule-exact tactical checks shared by the scripted baseline and the deployed bot.

These read the same state dicts the encoder does and mirror the engine's rules
(helpers.ts: checkVictory, netCost, canAfford).  They are used where a check
must be *certain*, not learned: the greedy baseline's win and block rules, and
the bot's "take a winning purchase" override.
"""

from __future__ import annotations

GEM_COLORS = ["white", "blue", "green", "red", "black"]
SPENDABLE_COLORS = ["white", "blue", "green", "red", "black", "pearl"]

# Victory thresholds -- helpers.ts PRESTIGE_WIN / CROWNS_WIN / COLOR_PRESTIGE_WIN.
PRESTIGE_WIN = 20
CROWNS_WIN = 10
COLOR_PRESTIGE_WIN = 10


def build_card_maps(state: dict) -> tuple[dict[int, dict], dict[int, int]]:
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


def prestige_per_color(player: dict) -> dict[str, float]:
    """Return current prestige points per gem color for a player."""
    by_color: dict[str, float] = {c: 0.0 for c in GEM_COLORS}
    for card in player.get("purchasedCards", []):
        color = card.get("assignedColor") or card.get("color")
        if color in GEM_COLORS:
            by_color[color] += card.get("points", 0)
    return by_color


def would_win(player: dict, card: dict) -> bool:
    """
    True if buying `card` is certain to win the game for `player`.

    The engine checks victory at the end of the turn (rulebook Phase 4.1), and
    nothing that can happen between a purchase and that check -- an ability,
    a royal card, a discard -- lowers prestige, crowns or a colour's prestige.
    So crossing a threshold with the purchase is a guaranteed win.

    Deliberately conservative: a wild card's colour is chosen after the
    purchase, so it counts towards total prestige and crowns but not towards a
    single colour; and prestige from a royal card claimed on the same turn is
    not predicted.  A False here only means "not certain".
    """
    card_points = card.get("points", 0)
    card_color = card.get("assignedColor") or card.get("color")
    card_crowns = card.get("crowns", 0)

    if player.get("prestige", 0) + card_points >= PRESTIGE_WIN:
        return True
    if player.get("crowns", 0) + card_crowns >= CROWNS_WIN:
        return True
    if card_color in GEM_COLORS:
        ppc = prestige_per_color(player)
        if ppc.get(card_color, 0) + card_points >= COLOR_PRESTIGE_WIN:
            return True
    return False


def can_afford(player: dict, card: dict) -> bool:
    """Return True if player has enough tokens (using gold as wild) to purchase card."""
    tokens = player.get("tokens", {})
    bonuses: dict[str, int] = {c: 0 for c in GEM_COLORS}
    for purchased in player.get("purchasedCards", []):
        color = purchased.get("assignedColor") or purchased.get("color")
        if color in GEM_COLORS:
            bonuses[color] += purchased.get("bonus", 0)

    cost = card.get("cost", {})
    gold_available = tokens.get("gold", 0)
    gold_needed = 0
    for color in SPENDABLE_COLORS:
        shortfall = max(0, cost.get(color, 0) - bonuses.get(color, 0) - tokens.get(color, 0))
        gold_needed += shortfall

    return gold_needed <= gold_available


def player_resources(player: dict) -> dict[str, int]:
    """Count tokens + bonuses per spendable color to gauge gem supply."""
    tokens = player.get("tokens", {})
    bonuses: dict[str, int] = {c: 0 for c in GEM_COLORS}
    for card in player.get("purchasedCards", []):
        color = card.get("assignedColor") or card.get("color")
        if color in GEM_COLORS:
            bonuses[color] += card.get("bonus", 0)
    return {c: tokens.get(c, 0) + bonuses.get(c, 0) for c in SPENDABLE_COLORS}


def winning_purchase(legal_moves: list[dict], state: dict) -> dict | None:
    """
    A legal purchase that wins the game outright for the player to move, if any.

    The policy is learned and can miss a one-move win, which is the most
    obviously wrong thing a bot can do in front of a human.  This makes that
    impossible without changing what the network was trained on.
    """
    player = state.get("players", [{}, {}])[state.get("currentPlayer", 0)]
    cards, _ = build_card_maps(state)
    for move in legal_moves:
        if move.get("type") != "PURCHASE_CARD":
            continue
        card = cards.get(move.get("cardId"))
        if card is not None and would_win(player, card):
            return move
    return None
