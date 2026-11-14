from __future__ import annotations

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from ai_trainer.model import ActorCriticNet
from ai_trainer.ppo import PPOConfig, update
from ai_trainer.self_play import Episode, Transition
from ai_trainer.state_encoder import encode, encode_card_ids
from builders import card, player, state, tokens


def make_episode(model: ActorCriticNet, n: int, rng: np.random.Generator) -> Episode:
    """A game of n alternating moves, played by `model` itself, that P1 wins."""
    ep = Episode()
    for t in range(n):
        level1 = [card(i + 1, blue=int(rng.integers(0, 4))) for i in range(5)]
        s = state([player(tokens(blue=int(rng.integers(0, 4)))), player()], level1, t % 2)
        obs, ids = encode(s), encode_card_ids(s)
        mask = np.zeros(358, dtype=bool)
        mask[rng.choice(358, size=8, replace=False)] = True
        with torch.no_grad():
            logits, value = model(torch.from_numpy(obs)[None], torch.from_numpy(ids)[None])
            dist = torch.distributions.Categorical(
                logits=logits.masked_fill(~torch.from_numpy(mask)[None], float("-inf"))
            )
            action = dist.sample()
        done = t == n - 1
        ep.transitions.append(
            Transition(
                obs=obs,
                card_ids=ids,
                action=int(action),
                log_prob=float(dist.log_prob(action)),
                value=float(value),
                reward=1.0 if done else 0.0,
                done=done,
                legal_mask=mask,
                player_id=t % 2,
            )
        )
    return ep


@pytest.fixture
def setup():
    torch.manual_seed(0)
    model = ActorCriticNet(trunk_depth=1, trunk_width=64).eval()
    rng = np.random.default_rng(0)
    episodes = [make_episode(model, 24, rng) for _ in range(4)]
    return model, episodes


class TestUpdate:
    def test_runs_every_minibatch_of_every_epoch_without_a_kl_target(self, setup):
        # Arrange: 96 transitions in minibatches of 16, over 3 epochs.
        model, episodes = setup
        opt = torch.optim.Adam(model.parameters(), lr=1e-4)
        config = PPOConfig(n_epochs=3, batch_size=16, target_kl=None)
        # Act
        stats = update(model, opt, episodes, config)
        # Assert
        assert stats["updates"] == 3 * 6
        assert not stats["early_stopped"]
        assert all(np.isfinite(stats[k]) for k in ("policy_loss", "value_loss", "kl"))

    def test_stops_early_once_the_policy_moves_too_far(self, setup):
        # Arrange: a large step size and a tiny KL budget.
        model, episodes = setup
        opt = torch.optim.Adam(model.parameters(), lr=1e-1)
        config = PPOConfig(n_epochs=4, batch_size=16, target_kl=1e-6)
        # Act
        stats = update(model, opt, episodes, config)
        # Assert: at least one step is always taken, but not the full run.
        assert stats["early_stopped"]
        assert 1 <= stats["updates"] < 4 * 6
