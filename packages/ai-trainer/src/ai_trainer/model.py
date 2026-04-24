"""
ActorCriticNet: shared-trunk policy + value network for Splendor Duel.

Input:  state tensor (STATE_DIM,)  # currently 859
Output: (logits (ACTION_SPACE_SIZE,), value scalar)

The policy head outputs raw logits. The caller is responsible for applying
the legal mask (set illegal logits to -inf) before computing the softmax.
"""

from __future__ import annotations

import torch
import torch.nn as nn

from .state_encoder import STATE_DIM
from .action_space import ACTION_SPACE_SIZE


class ActorCriticNet(nn.Module):
    def __init__(self) -> None:
        super().__init__()

        self.trunk = nn.Sequential(
            nn.Linear(STATE_DIM, 512),
            nn.ReLU(),
            nn.Linear(512, 256),
            nn.ReLU(),
        )
        self.policy_head = nn.Linear(256, ACTION_SPACE_SIZE)
        self.value_head = nn.Linear(256, 1)

    def forward(
        self, obs: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """
        Args:
            obs: float tensor of shape (..., STATE_DIM)
        Returns:
            logits: shape (..., ACTION_SPACE_SIZE)  — raw, unmasked
            value:  shape (..., 1)
        """
        h = self.trunk(obs)
        return self.policy_head(h), self.value_head(h)

    def masked_policy(
        self,
        obs: torch.Tensor,
        legal_mask: torch.Tensor,
    ) -> torch.distributions.Categorical:
        """
        Returns a Categorical distribution over legal actions.

        Args:
            obs:        shape (..., STATE_DIM)
            legal_mask: bool tensor of shape (..., ACTION_SPACE_SIZE); True = legal
        """
        logits, _ = self.forward(obs)
        logits = logits.masked_fill(~legal_mask, float("-inf"))
        return torch.distributions.Categorical(logits=logits)
