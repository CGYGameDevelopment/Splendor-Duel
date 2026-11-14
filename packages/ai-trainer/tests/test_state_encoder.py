from __future__ import annotations

import numpy as np
import pytest

from ai_trainer.state_encoder import (
    C_AFFORD_ME,
    C_AFFORD_OPP,
    C_PRESENT,
    C_SHORT_ME,
    C_SHORT_OPP,
    CARD_FEATURES,
    CUR_START,
    DEFAULT_SCALES,
    N_PYRAMID_SLOTS,
    N_RESERVED,
    OPP_START,
    P_RESERVED_COUNT,
    P_RESERVED_START,
    PYRAMID_START,
    STATE_DIM,
    encode,
    encode_card_ids,
)
from builders import card, player, state, tokens


def pyramid_card(obs: np.ndarray, slot: int) -> np.ndarray:
    start = PYRAMID_START + slot * CARD_FEATURES
    return obs[start : start + CARD_FEATURES]


def reserved_card(obs: np.ndarray, player_start: int, slot: int) -> np.ndarray:
    start = player_start + P_RESERVED_START + slot * CARD_FEATURES
    return obs[start : start + CARD_FEATURES]


class TestHiddenReservedCards:
    def test_sim_state_and_server_state_encode_identically(self):
        # Arrange: the sim sends the opponent's reserved cards; the server sends
        # only their count.
        secret = [card(5, points=3, red=4), card(6, color="green", black=2)]
        sim_view = state([player(), player(reserved=secret)])
        server_opponent = player()
        server_opponent["reservedCardCount"] = 2
        server_view = state([player(), server_opponent])
        # Act / Assert
        np.testing.assert_array_equal(encode(sim_view), encode(server_view))

    def test_opponent_reserved_count_is_still_encoded(self):
        s = state([player(), player(reserved=[card(5), card(6)])])
        obs = encode(s)
        assert obs[OPP_START + P_RESERVED_COUNT] == pytest.approx(2 / DEFAULT_SCALES.reserved)
        for slot in range(N_RESERVED):
            assert not reserved_card(obs, OPP_START, slot).any()

    def test_own_reserved_cards_are_encoded(self):
        s = state([player(reserved=[card(5)]), player()])
        obs = encode(s)
        assert reserved_card(obs, CUR_START, 0)[C_PRESENT] == 1.0

    def test_card_ids_expose_only_the_current_players_reserved_cards(self):
        s = state([player(reserved=[card(5)]), player(reserved=[card(6), card(7)])])
        ids = encode_card_ids(s)
        assert ids[N_PYRAMID_SLOTS] == 5
        assert not ids[N_PYRAMID_SLOTS + N_RESERVED :].any()


class TestAffordability:
    def test_exact_tokens_make_a_card_affordable(self):
        s = state([player(tokens(blue=2, red=1)), player()], [card(1, blue=2, red=1)])
        feats = pyramid_card(encode(s), 0)
        assert feats[C_AFFORD_ME] == 1.0
        assert feats[C_SHORT_ME] == 0.0

    def test_bonuses_and_gold_cover_the_cost(self):
        # Arrange: cost 3 blue = 1 blue bonus + 1 blue token + 1 gold.
        blue_card = card(10, color="blue", bonus=1)
        me = player(tokens(blue=1, gold=1), purchased=[blue_card])
        s = state([me, player()], [card(1, blue=3)])
        assert pyramid_card(encode(s), 0)[C_AFFORD_ME] == 1.0

    def test_shortfall_counts_tokens_still_missing_after_gold(self):
        s = state([player(tokens(blue=1)), player()], [card(1, blue=3, pearl=1)])
        feats = pyramid_card(encode(s), 0)
        assert feats[C_AFFORD_ME] == 0.0
        assert feats[C_SHORT_ME] == pytest.approx(3 / DEFAULT_SCALES.shortfall)

    def test_bonuses_do_not_reduce_pearl_costs(self):
        white_card = card(10, color="white", bonus=2)
        s = state([player(purchased=[white_card]), player()], [card(1, pearl=1)])
        assert pyramid_card(encode(s), 0)[C_AFFORD_ME] == 0.0

    def test_a_wild_card_needs_a_coloured_card_to_copy(self):
        wild = card(1, color=None, ability="wild")  # free, but nothing to copy
        no_colour = state([player(), player()], [wild])
        with_colour = state([player(purchased=[card(10, color="red")]), player()], [wild])
        assert pyramid_card(encode(no_colour), 0)[C_AFFORD_ME] == 0.0
        assert pyramid_card(encode(with_colour), 0)[C_AFFORD_ME] == 1.0

    def test_opponent_affordability_is_from_the_opponents_purse(self):
        s = state([player(), player(tokens(red=2))], [card(1, red=2)])
        feats = pyramid_card(encode(s), 0)
        assert feats[C_AFFORD_ME] == 0.0
        assert feats[C_AFFORD_OPP] == 1.0
        assert feats[C_SHORT_OPP] == 0.0


def test_observation_has_the_declared_size_and_range():
    s = state([player(tokens(gold=3)), player()], [card(1, blue=8, red=8, green=8)])
    obs = encode(s)
    assert obs.shape == (STATE_DIM,)
    assert obs.min() >= 0.0 and obs.max() <= 1.0
