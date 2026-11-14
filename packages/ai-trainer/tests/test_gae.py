"""
Zero-sum GAE: the sign of every bootstrap and every carried advantage depends
on whose turn the next step is.  A flip in the wrong place does not crash; it
trains the policy to help the opponent.  These pin the perspective handling.
"""

from __future__ import annotations

import numpy as np
import pytest

from ai_trainer.gae import compute_gae


def run(rewards, values, dones, players, gamma=1.0, lam=1.0, terminal_value=0.0, terminal_player=0):
    n = len(rewards)
    adv = np.zeros(n, dtype=np.float32)
    ret = np.zeros(n, dtype=np.float32)
    compute_gae(
        rewards, values, dones, players, gamma, lam, adv, ret, terminal_value, terminal_player
    )
    return adv, ret


class TestTerminalRewardPerspective:
    def test_alternating_turns_give_the_loser_minus_one(self):
        # Arrange: P0 moves, then P1 moves and wins.
        # Act
        _, ret = run(rewards=[0.0, 1.0], values=[0.0, 0.0], dones=[False, True], players=[0, 1])
        # Assert
        assert ret.tolist() == pytest.approx([-1.0, 1.0])

    def test_consecutive_moves_by_the_winner_all_receive_plus_one(self):
        # Arrange: an extra turn -- P0 moves twice and wins.
        _, ret = run(rewards=[0.0, 1.0], values=[0.0, 0.0], dones=[False, True], players=[0, 0])
        assert ret.tolist() == pytest.approx([1.0, 1.0])

    def test_outcome_reaches_the_opening_with_alternating_signs(self):
        # Arrange: P0, P1, P0, P1 -- P1 wins on the last move.
        _, ret = run(
            rewards=[0.0, 0.0, 0.0, 1.0],
            values=[0.0] * 4,
            dones=[False, False, False, True],
            players=[0, 1, 0, 1],
        )
        assert ret.tolist() == pytest.approx([-1.0, 1.0, -1.0, 1.0])


class TestBootstrap:
    def test_truncated_segment_flips_a_value_from_the_opponents_frame(self):
        # Arrange: P0 acted last; the state after it is P1's, valued +0.5 for P1.
        _, ret = run(
            rewards=[0.0],
            values=[0.0],
            dones=[False],
            players=[0],
            terminal_value=0.5,
            terminal_player=1,
        )
        # Assert: that is -0.5 for P0.
        assert ret.tolist() == pytest.approx([-0.5])

    def test_truncated_segment_keeps_a_value_in_the_same_frame(self):
        _, ret = run(
            rewards=[0.0],
            values=[0.0],
            dones=[False],
            players=[0],
            terminal_value=0.5,
            terminal_player=0,
        )
        assert ret.tolist() == pytest.approx([0.5])

    def test_one_step_td_negates_the_opponents_next_value(self):
        # Arrange: lambda=0 makes each advantage a one-step TD error.
        values = [0.2, 0.6, -0.1]
        adv, _ = run(
            rewards=[0.0, 0.0, 0.0],
            values=values,
            dones=[False, False, False],
            players=[0, 1, 1],
            lam=0.0,
            terminal_value=0.0,
            terminal_player=0,
        )
        # Assert: P1's next state is P0's (negated); P1's own next state is not.
        assert adv[0] == pytest.approx(-0.6 - 0.2)
        assert adv[1] == pytest.approx(-0.1 - 0.6)

    def test_advantage_is_return_minus_value(self):
        values = [0.3, -0.2, 0.4]
        adv, ret = run(
            rewards=[0.0, 0.0, -1.0],
            values=values,
            dones=[False, False, True],
            players=[0, 1, 0],
            lam=0.9,
        )
        assert (ret - adv).tolist() == pytest.approx(values)
