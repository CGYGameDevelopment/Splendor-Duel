from __future__ import annotations

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from ai_trainer.action_space import (
    ACTION_SPACE_SIZE,
    OFFSET_PURCHASE_CARD,
    OFFSET_RESERVE_PYRAMID,
)
from ai_trainer.model import ActorCriticNet
from ai_trainer.state_encoder import encode, encode_card_ids
from builders import card, player, state, tokens


def batch(*states: dict):
    obs = torch.from_numpy(np.stack([encode(s) for s in states]))
    ids = torch.from_numpy(np.stack([encode_card_ids(s) for s in states]))
    return obs, ids


@pytest.fixture(scope="module")
def model() -> ActorCriticNet:
    torch.manual_seed(0)
    net = ActorCriticNet(trunk_depth=1, trunk_width=64)
    # The policy outputs start near zero by design; widen them so the
    # comparisons below are between visibly different numbers.
    for head in (net.cell_scores[-1], net.card_scores[-1], net.misc_head):
        torch.nn.init.normal_(head.weight, std=1.0)
    return net.eval()


def sample_state(level1: list[dict]) -> dict:
    me = player(tokens(blue=2, red=1, gold=1), reserved=[card(30, color="green", black=3)])
    return state([me, player(tokens(white=2))], level1=level1)


class TestShapes:
    def test_one_logit_per_action_and_one_value(self, model):
        obs, ids = batch(sample_state([card(1, blue=2)]), sample_state([card(2, red=3)]))
        with torch.no_grad():
            logits, value = model(obs, ids)
        assert logits.shape == (2, ACTION_SPACE_SIZE)
        assert value.shape == (2, 1)


class TestCardPointerHead:
    def test_card_logits_follow_the_card_not_its_slot(self, model):
        # Arrange: the same two level-1 cards in either order.
        a, b = card(4, blue=2), card(9, color="red", points=1, white=3)
        obs, ids = batch(sample_state([a, b]), sample_state([b, a]))
        # Act
        with torch.no_grad():
            logits, _ = model(obs, ids)
        # Assert: the purchase and reserve logits of each card are unchanged.
        for cid in (4, 9):
            for offset in (OFFSET_PURCHASE_CARD, OFFSET_RESERVE_PYRAMID):
                idx = offset + cid - 1
                assert logits[0, idx].item() == pytest.approx(logits[1, idx].item(), abs=1e-5)

    def test_reserved_cards_get_a_purchase_logit_but_not_a_reserve_one(self, model):
        obs, ids = batch(sample_state([card(4, blue=2)]))
        with torch.no_grad():
            logits, _ = model(obs, ids)
        assert logits[0, OFFSET_PURCHASE_CARD + 30 - 1].item() != 0.0
        assert logits[0, OFFSET_RESERVE_PYRAMID + 30 - 1].item() == 0.0

    def test_cards_not_on_the_table_have_no_logit(self, model):
        obs, ids = batch(sample_state([card(4, blue=2)]))
        with torch.no_grad():
            logits, _ = model(obs, ids)
        assert logits[0, OFFSET_PURCHASE_CARD + 50 - 1].item() == 0.0
