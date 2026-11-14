"""Hand-built game-state dicts in the shape the sim and the server send."""

from __future__ import annotations

TOKEN_COLORS = ["white", "blue", "green", "red", "black", "pearl", "gold"]


def tokens(**counts: int) -> dict[str, int]:
    pool = {c: 0 for c in TOKEN_COLORS}
    pool.update(counts)
    return pool


def card(
    card_id: int,
    color: str | None = "blue",
    points: int = 0,
    bonus: int = 1,
    ability: str | None = None,
    crowns: int = 0,
    assigned: str | None = None,
    **cost: int,
) -> dict:
    return {
        "id": card_id,
        "level": 1,
        "color": color,
        "points": points,
        "bonus": bonus,
        "ability": ability,
        "crowns": crowns,
        "cost": cost,
        "assignedColor": assigned,
    }


def player(
    token_pool: dict | None = None,
    purchased: list[dict] | None = None,
    reserved: list[dict] | None = None,
    prestige: int = 0,
    crowns: int = 0,
    privileges: int = 0,
) -> dict:
    return {
        "tokens": token_pool or tokens(),
        "purchasedCards": purchased or [],
        "reservedCards": reserved or [],
        "royalCards": [],
        "prestige": prestige,
        "crowns": crowns,
        "privileges": privileges,
    }


def state(
    players: list[dict],
    level1: list[dict] | None = None,
    current: int = 0,
    phase: str = "mandatory",
) -> dict:
    return {
        "board": [None] * 25,
        "bag": tokens(),
        "pyramid": {"level1": level1 or [], "level2": [], "level3": []},
        "deckCounts": {"level1": 20, "level2": 15, "level3": 10},
        "royalDeck": [],
        "privileges": 3,
        "players": players,
        "currentPlayer": current,
        "phase": phase,
        "extraTurns": 0,
        "pendingAbility": None,
    }
