"""
Tests for the canonical action vocabulary.

action_space.py reimplements part of the TypeScript engine's rules — the 145
valid token lines, the card id ranges, and the shape of every action. Nothing
links the two, so a change on the engine side desyncs the RL action mask
silently: training does not crash, it just optimises against a mask that no
longer matches the game.

The fixture these tests read is generated from the real engine by
scripts/generate_action_fixture.js, and CI regenerates it and fails on a diff.
"""

from __future__ import annotations

import json
from itertools import combinations
from pathlib import Path

import pytest

from ai_trainer.action_space import (
    ACTION_SPACE_SIZE,
    GEM_COLORS,
    LINE_TO_IDX,
    OFFSET_DISCARD,
    OFFSET_PASS_MANDATORY,
    OFFSET_USE_PRIVILEGE,
    TAKE_FROM_OPPONENT_COLORS,
    TOKEN_COLORS,
    VALID_LINES,
    action_to_index,
    build_legal_index_map_and_mask,
    index_to_action,
)

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "legal_moves.json"


@pytest.fixture(scope="module")
def fixture() -> dict:
    with FIXTURE_PATH.open() as handle:
        return json.load(handle)


@pytest.fixture(scope="module")
def samples(fixture: dict) -> list[dict]:
    return fixture["samples"]


# ── Vocabulary shape ─────────────────────────────────────────────────────────


def test_valid_lines_count_matches_the_documented_vocabulary():
    # The 145 figure is baked into ACTION_SPACE_SIZE and every offset after it.
    assert len(VALID_LINES) == 145
    assert len(LINE_TO_IDX) == 145


def test_offsets_tile_the_space_without_gaps_or_overlap():
    # Arrange — the documented layout, in order.
    boundaries = [
        (0, 145),  # TAKE_TOKENS
        (145, 67),  # PURCHASE_CARD
        (212, 67),  # RESERVE_CARD_FROM_PYRAMID
        (279, 3),  # RESERVE_CARD_FROM_DECK
        (282, 5),  # ASSIGN_WILD_COLOR
        (287, 25),  # USE_PRIVILEGE
        (312, 1),  # REPLENISH_BOARD
        (313, 1),  # END_OPTIONAL_PHASE
        (314, 1),  # SKIP_TO_MANDATORY
        (315, 7),  # DISCARD_TOKENS
        (322, 25),  # TAKE_TOKEN_FROM_BOARD
        (347, 6),  # TAKE_TOKEN_FROM_OPPONENT
        (353, 4),  # CHOOSE_ROYAL_CARD
        (357, 1),  # PASS_MANDATORY
    ]

    # Act / Assert — each range starts exactly where the previous one ended.
    cursor = 0
    for offset, size in boundaries:
        assert offset == cursor, f"gap or overlap before offset {offset}"
        cursor += size
    assert cursor == ACTION_SPACE_SIZE


def test_every_valid_line_is_a_straight_unbroken_run():
    # Arrange / Act / Assert — the Python copy of the line rule must agree with
    # the engine's isValidTokenLine for all 1..3 cell selections.
    for line in VALID_LINES:
        coords = [divmod(index, 5) for index in line]
        if len(coords) == 1:
            continue
        delta = (coords[1][0] - coords[0][0], coords[1][1] - coords[0][1])
        assert abs(delta[0]) <= 1 and abs(delta[1]) <= 1
        assert delta != (0, 0)
        for previous, current in zip(coords, coords[1:]):
            assert (current[0] - previous[0], current[1] - previous[1]) == delta


def test_no_invalid_line_sneaks_into_the_vocabulary():
    # Arrange — brute force every 1..3 subset of the 25 cells.
    expected = set()
    for length in range(1, 4):
        for combo in combinations(range(25), length):
            coords = [divmod(index, 5) for index in combo]
            if length == 1:
                expected.add(combo)
                continue
            delta = (coords[1][0] - coords[0][0], coords[1][1] - coords[0][1])
            if abs(delta[0]) > 1 or abs(delta[1]) > 1 or delta == (0, 0):
                continue
            if all(
                (current[0] - previous[0], current[1] - previous[1]) == delta
                for previous, current in zip(coords, coords[1:])
            ):
                expected.add(combo)

    # Act / Assert
    assert set(VALID_LINES) == expected


# ── Narrowed action shapes ───────────────────────────────────────────────────
#
# USE_PRIVILEGE carries a single `index` and DISCARD_TOKENS a single `color`.
# Both used to be collection-shaped (`indices: [n]`, `tokens: {color: 1}`) while
# the reducer only ever accepted exactly one entry.


def test_use_privilege_maps_from_a_single_index():
    for index in range(25):
        assert action_to_index({"type": "USE_PRIVILEGE", "index": index}) == (
            OFFSET_USE_PRIVILEGE + index
        )


@pytest.mark.parametrize("bad", [-1, 25, 1.5, "3", None])
def test_use_privilege_rejects_an_out_of_range_index(bad):
    assert action_to_index({"type": "USE_PRIVILEGE", "index": bad}) is None


def test_use_privilege_rejects_the_old_collection_shape():
    assert action_to_index({"type": "USE_PRIVILEGE", "indices": [3]}) is None


def test_discard_maps_from_a_single_color():
    for position, color in enumerate(TOKEN_COLORS):
        assert action_to_index({"type": "DISCARD_TOKENS", "color": color}) == (
            OFFSET_DISCARD + position
        )


def test_discard_rejects_an_unknown_color():
    assert action_to_index({"type": "DISCARD_TOKENS", "color": "notacolor"}) is None


def test_discard_rejects_the_old_collection_shape():
    assert action_to_index({"type": "DISCARD_TOKENS", "tokens": {"black": 1}}) is None


def test_take_from_opponent_never_maps_gold():
    assert "gold" not in TAKE_FROM_OPPONENT_COLORS
    assert action_to_index({"type": "TAKE_TOKEN_FROM_OPPONENT", "color": "gold"}) is None


def test_assign_wild_accepts_only_gem_colors():
    for color in GEM_COLORS:
        assert action_to_index({"type": "ASSIGN_WILD_COLOR", "color": color}) is not None
    for color in ("pearl", "gold", "notacolor"):
        assert action_to_index({"type": "ASSIGN_WILD_COLOR", "color": color}) is None


def test_unknown_action_type_is_unmapped():
    assert action_to_index({"type": "GIVE_ME_TOKENS"}) is None
    assert action_to_index({}) is None


def test_pass_mandatory_is_the_final_index():
    assert action_to_index({"type": "PASS_MANDATORY"}) == OFFSET_PASS_MANDATORY
    assert OFFSET_PASS_MANDATORY == ACTION_SPACE_SIZE - 1


# ── Agreement with the engine ────────────────────────────────────────────────


def test_fixture_covers_the_interesting_phases(fixture: dict):
    # A fixture that never reached discard or an ability resolution would make
    # the agreement tests below much weaker than they look.
    for phase in (
        "mandatory",
        "optional_privilege",
        "optional_replenish",
        "discard",
        "resolve_ability",
        "assign_wild",
        "choose_royal",
    ):
        assert phase in fixture["phasesCovered"]


def test_every_engine_action_maps_to_an_index(samples: list[dict]):
    # Arrange
    unmapped = []

    # Act
    for sample in samples:
        for action in sample["legalMoves"]:
            if action_to_index(action) is None:
                unmapped.append((sample["phase"], action))

    # Assert — an unmapped legal move is invisible to the policy: the mask has a
    # zero where the game offers a choice.
    assert unmapped == [], f"engine actions with no canonical index: {unmapped[:5]}"


def test_every_index_is_within_the_action_space(samples: list[dict]):
    for sample in samples:
        for action in sample["legalMoves"]:
            index = action_to_index(action)
            assert index is not None
            assert 0 <= index < ACTION_SPACE_SIZE, f"{action} -> {index}"


def test_no_two_legal_moves_collide_on_one_index(samples: list[dict]):
    # build_legal_index_map_and_mask asserts on collision, so this would raise
    # rather than fail an assertion — either way it must not happen.
    for sample in samples:
        index_map, mask = build_legal_index_map_and_mask(sample["legalMoves"])
        assert int(mask.sum()) == len(sample["legalMoves"]), (
            f"phase {sample['phase']}: {len(sample['legalMoves'])} legal moves "
            f"collapsed to {int(mask.sum())} mask entries"
        )
        assert len(index_map) == len(sample["legalMoves"])


def test_indices_round_trip_back_to_the_original_action(samples: list[dict]):
    # index_to_action cross-references the legal move list rather than
    # reconstructing, so goldUsage and other payload fields must survive.
    for sample in samples:
        for action in sample["legalMoves"]:
            index = action_to_index(action)
            assert index is not None
            assert index_to_action(index, sample["legalMoves"]) == action


def test_mask_marks_only_legal_moves(samples: list[dict]):
    for sample in samples:
        _, mask = build_legal_index_map_and_mask(sample["legalMoves"])
        legal_indices = {action_to_index(a) for a in sample["legalMoves"]}
        assert set(np_nonzero(mask)) == legal_indices


def np_nonzero(mask) -> list[int]:
    return [int(i) for i in mask.nonzero()[0]]


def test_gold_funded_purchases_are_representable(samples: list[dict]):
    # legalMoves once filtered out every card that needed gold before computing
    # a gold allocation, so gold was unusable for purchases. If that regresses,
    # the fixture stops containing these entirely.
    gold_funded = [
        action
        for sample in samples
        for action in sample["legalMoves"]
        if action["type"] == "PURCHASE_CARD" and any(action.get("goldUsage", {}).values())
    ]
    assert gold_funded, "fixture contains no gold-funded purchase to check"

    for action in gold_funded:
        index = action_to_index(action)
        assert index is not None
        # PURCHASE_CARD is indexed by card id alone; the allocation is recovered
        # by cross-referencing, which is what keeps the space from exploding.
        same_card = [action]
        assert index_to_action(index, same_card) == action
