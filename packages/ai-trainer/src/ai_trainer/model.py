"""
ActorCriticNet: structured policy + value network for Splendor Duel.

Architecture
------------
Routes each logical sub-group through a dedicated encoder before merging,
giving the model an explicit inductive bias that matches the game's structure:

  card_encoder:          13 → 64 → 64  (shared weights for pyramid and reserved cards)
    pyramid per level:   L1(5) / L2(4) / L3(3) cards → sum-pool → 64 each
  player_encoder:        applied symmetrically to current player and opponent
    scalar branch:       27 non-card features → 64
    reserved branch:     3 reserved cards via card_encoder → max-pool → 64
    combiner:            cat(64, 64) → 64
  global_encoder:        22 (bag, decks, royal deck, table priv, phase, etc.) → 64

  trunk input:  3×64 + 2×64 + 64 = 384
  trunk:        384 → 512 → 256  (LayerNorm + ReLU, Dropout(0.1) after first layer)

  policy_head:  256 → ACTION_SPACE_SIZE   (orthogonal init, gain 0.01)
  value_head:   256 → 1                   (orthogonal init, gain 1.0)

Weight sharing on card_encoder means a single "card evaluator" runs across the
pyramid and player reserved cards.  Royal cards (prestige + has_ability only) and
the board (bag aggregate sufficient for policy) are folded into global context.
"""

from __future__ import annotations

import torch
import torch.nn as nn

from .state_encoder import STATE_DIM, CARD_FEATURES, ROYAL_FEATURES, PLAYER_FEATURES
from .action_space import ACTION_SPACE_SIZE

# ── State layout constants ─────────────────────────────────────────────────────
# These mirror the layout documented in state_encoder.py and must stay in sync.

_BAG_START = 0            # [0:7]     bag: 7 token counts
_BAG_END = 7
_PYRAMID_START = 7        # [7:163]   pyramid: 12 × 13
_PYRAMID_END = 163
_N_PYRAMID = 12
_N_L1, _N_L2, _N_L3 = 5, 4, 3
_DECK_START = 163         # [163:166] deck sizes
_DECK_END = 166
_ROYAL_START = 166        # [166:174] royal deck: 4 × 2
_ROYAL_END = 174
_N_ROYAL = 4
_TABLE_PRIV = 174         # [174]     table privileges
_CUR_START = 175          # [175:241] current-player features
_CUR_END = 241
_OPP_START = 241          # [241:307] opponent features
_OPP_END = 307
_PHASE = 307              # [307]     phase index (single float)
_EXTRA_TURNS = 309        # [309]     extra turns  (308 always 0 — skipped)
_PENDING = 310            # [310]     pending ability index (single float)

# ── Per-player sub-layout ──────────────────────────────────────────────────────
# [0:21]   scalar stats (tokens, bonuses, prestige per color, totals, reserved count)
# [21:60]  reserved cards: 3 × 13
# [60:66]  royal compact scalars: 3 × 2
_P_SCALAR_END = 21
_P_RESERVED_END = 21 + 3 * CARD_FEATURES   # = 60
_P_ROYAL_START = _P_RESERVED_END           # = 60
_N_RESERVED = 3
_PLAYER_SCALARS = _P_SCALAR_END + (PLAYER_FEATURES - _P_ROYAL_START)  # 21 + 6 = 27

# ── Branch output dimensions ───────────────────────────────────────────────────
_CARD_DIM = 64
_PLAYER_OUT = 64
_GLOBAL_OUT = 64
_GLOBAL_IN = 22   # bag(7) + decks(3) + royal_deck(8) + table_priv(1) + phase(1) + extra_turns(1) + pending(1)
_TRUNK_IN = (
    3 * _CARD_DIM     # pyramid levels 192
    + 2 * _PLAYER_OUT  # cur + opp      128
    + _GLOBAL_OUT      # global context  64
)  # = 384
_HIDDEN_1 = 512
_HIDDEN_2 = 256


def _mlp(*dims: int) -> nn.Sequential:
    """Linear → LayerNorm → ReLU stack.  All layers including the last are activated."""
    layers: list[nn.Module] = []
    for in_d, out_d in zip(dims, dims[1:]):
        layers += [nn.Linear(in_d, out_d), nn.LayerNorm(out_d), nn.ReLU()]
    return nn.Sequential(*layers)


class ActorCriticNet(nn.Module):
    def __init__(self, dropout: float = 0.1) -> None:
        super().__init__()

        # Shared card encoder — same weights for pyramid and reserved cards.
        self.card_encoder = _mlp(CARD_FEATURES, _CARD_DIM, _CARD_DIM)

        # Per-player: scalar stats branch (shared between current player and opponent).
        self.player_scalar_enc = _mlp(_PLAYER_SCALARS, _PLAYER_OUT)
        # Combines scalar encoding with pooled reserved-card encoding.
        self.player_combiner = _mlp(_PLAYER_OUT + _CARD_DIM, _PLAYER_OUT)

        # Global context: bag, deck sizes, royal deck, phase index, etc.
        self.global_encoder = _mlp(_GLOBAL_IN, _GLOBAL_OUT)

        # Main trunk
        self.trunk = nn.Sequential(
            nn.Linear(_TRUNK_IN, _HIDDEN_1),
            nn.LayerNorm(_HIDDEN_1),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(_HIDDEN_1, _HIDDEN_2),
            nn.LayerNorm(_HIDDEN_2),
            nn.ReLU(),
        )

        self.policy_head = nn.Linear(_HIDDEN_2, ACTION_SPACE_SIZE)
        self.value_head = nn.Linear(_HIDDEN_2, 1)

        nn.init.orthogonal_(self.policy_head.weight, gain=0.01)
        nn.init.constant_(self.policy_head.bias, 0.0)
        nn.init.orthogonal_(self.value_head.weight, gain=1.0)
        nn.init.constant_(self.value_head.bias, 0.0)

    # ── Sub-encoders ───────────────────────────────────────────────────────────

    def _encode_player(self, p: torch.Tensor) -> torch.Tensor:
        """Encode one player's 66-dim feature vector → (_PLAYER_OUT,)."""
        # Scalar stats: pre-reserved slice + post-reserved (royal) slice
        scalars = torch.cat([p[..., :_P_SCALAR_END], p[..., _P_ROYAL_START:]], dim=-1)
        # Reserved cards: reshape to (..., 3, 13), encode, max-pool over card axis.
        # Max-pool so a single high-value reserved card dominates regardless of other slots.
        batch = p.shape[:-1]
        reserved = p[..., _P_SCALAR_END:_P_RESERVED_END].reshape(*batch, _N_RESERVED, CARD_FEATURES)
        h_res = self.card_encoder(reserved).max(dim=-2).values  # (..., _CARD_DIM)
        h_sc = self.player_scalar_enc(scalars)                   # (..., _PLAYER_OUT)
        return self.player_combiner(torch.cat([h_sc, h_res], dim=-1))

    # ── Forward ────────────────────────────────────────────────────────────────

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
        batch = obs.shape[:-1]

        # Pyramid: encode all 12 cards at once then split by level.
        pyr = obs[..., _PYRAMID_START:_PYRAMID_END].reshape(*batch, _N_PYRAMID, CARD_FEATURES)
        pyr_emb = self.card_encoder(pyr)                      # (..., 12, _CARD_DIM)
        h_l1 = pyr_emb[..., :_N_L1, :].sum(-2)               # (..., _CARD_DIM)
        h_l2 = pyr_emb[..., _N_L1:_N_L1 + _N_L2, :].sum(-2)
        h_l3 = pyr_emb[..., _N_L1 + _N_L2:, :].sum(-2)

        # Player branches (shared encoder, applied symmetrically).
        h_cur = self._encode_player(obs[..., _CUR_START:_CUR_END])
        h_opp = self._encode_player(obs[..., _OPP_START:_OPP_END])

        # Global context (index 308 always 0 — skipped).
        global_ctx = torch.cat([
            obs[..., _BAG_START:_BAG_END],              # bag          [0:7]
            obs[..., _DECK_START:_DECK_END],            # deck sizes   [163:166]
            obs[..., _ROYAL_START:_ROYAL_END],          # royal deck   [166:174]
            obs[..., _TABLE_PRIV:_TABLE_PRIV + 1],      # table priv   [174]
            obs[..., _PHASE:_PHASE + 1],                # phase idx    [307]
            obs[..., _EXTRA_TURNS:_EXTRA_TURNS + 1],    # extra turns  [309]
            obs[..., _PENDING:_PENDING + 1],            # pending idx  [310]
        ], dim=-1)
        h_global = self.global_encoder(global_ctx)

        h = torch.cat([h_l1, h_l2, h_l3, h_cur, h_opp, h_global], dim=-1)
        h = self.trunk(h)
        return self.policy_head(h), self.value_head(h)

    def masked_policy(
        self,
        obs: torch.Tensor,
        legal_mask: torch.Tensor,
    ) -> torch.distributions.Categorical:
        """Returns a Categorical distribution over legal actions.

        Args:
            obs:        shape (..., STATE_DIM)
            legal_mask: bool tensor of shape (..., ACTION_SPACE_SIZE); True = legal
        """
        logits, _ = self.forward(obs)
        logits = logits.masked_fill(~legal_mask, float("-inf"))
        return torch.distributions.Categorical(logits=logits)
