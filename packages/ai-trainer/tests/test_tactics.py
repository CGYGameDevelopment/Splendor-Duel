from __future__ import annotations

from ai_trainer.tactics import winning_purchase
from builders import card, player, state, tokens


def purchase(card_id: int) -> dict:
    return {"type": "PURCHASE_CARD", "cardId": card_id, "goldUsage": {}}


class TestWinningPurchase:
    def test_finds_a_purchase_that_reaches_20_prestige(self):
        # Arrange
        winner = card(1, points=3)
        s = state([player(prestige=17), player()], level1=[card(2, points=1), winner])
        # Act
        move = winning_purchase([purchase(2), purchase(1)], s)
        # Assert
        assert move == purchase(1)

    def test_finds_a_purchase_that_reaches_10_crowns(self):
        s = state([player(crowns=8), player()], level1=[card(1, crowns=2)])
        assert winning_purchase([purchase(1)], s) == purchase(1)

    def test_finds_a_purchase_that_reaches_10_prestige_in_one_colour(self):
        owned = card(10, color="red", points=7)
        s = state([player(purchased=[owned], prestige=7), player()], level1=[card(1, "red", 3)])
        assert winning_purchase([purchase(1)], s) == purchase(1)

    def test_does_not_count_a_wild_card_towards_a_single_colour(self):
        # The wild's colour is chosen after the purchase, so the win is not certain.
        owned = card(10, color="red", points=7)
        wild = card(1, color=None, points=3, ability="wild")
        s = state([player(purchased=[owned], prestige=7), player()], level1=[wild])
        assert winning_purchase([purchase(1)], s) is None

    def test_ignores_non_purchase_moves_and_non_winning_cards(self):
        s = state([player(prestige=10), player()], level1=[card(1, points=3)])
        moves = [purchase(1), {"type": "TAKE_TOKENS", "indices": [0]}]
        assert winning_purchase(moves, s) is None

    def test_considers_the_player_to_move(self):
        s = state([player(), player(prestige=19, token_pool=tokens())], [card(1, points=1)], 1)
        assert winning_purchase([purchase(1)], s) == purchase(1)
