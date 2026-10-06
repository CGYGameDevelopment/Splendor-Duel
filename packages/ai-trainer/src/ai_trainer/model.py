"""
ActorCriticNet: structured policy + value network for Splendor Duel.

Architecture
------------
  cell_encoder:          8 -> 32           (shared across all 25 board cells)
  board_summary:         25*32 -> 128      (board context for the trunk)
  card_encoder:          24 -> 64 -> 64    (shared: pyramid and reserved cards)
    pyramid per level:   L1(5) / L2(4) / L3(3) -> sum-pool -> 64 each
  player_encoder:        applied symmetrically to current player and opponent
    scalar branch:       27 non-card features -> 64
    reserved branch:     3 reserved cards via card_encoder -> max-pool -> 64
    combiner:            cat(64, 64) -> 64
  global_encoder:        33 -> 64

  trunk input:  128 + 3x64 + 2x64 + 64 = 512
  trunk:        512 -> [4 x ResBlock(512)] -> 256   (LayerNorm + ReLU throughout)

  value_head:   256 -> 1
  policy:       assembled from three sources, see "Policy head" below

No dropout
----------
Rollouts run under eval() and the PPO update under train().  With dropout
active only in the latter, the importance ratio on the first minibatch of the
first epoch is not 1.0 -- measured 0.9964..1.0056 at initialisation, and worse
as weights grow.  That is noise injected straight into the ratio and into the
reported KL.  On-policy PPO relies on entropy regularisation for exploration,
not dropout, so the default is 0.0.

Policy head
-----------
A single Linear(256 -> 358) had to learn every action's logit as an independent
output row, which is a poor fit for this action space:

  * 195 of the 358 indices name board cells (145 token lines, 25 privilege
    cells, 25 ability-take cells).  A line is literally a set of cells, but a
    flat head learns {6,7,8} and {7,8,9} as unrelated outputs.
  * 134 indices name card ids (67 purchase, 67 reserve).  A given card is
    face-up only ~17-23% of the time, so each of those rows saw gradient in
    about one state in five, and nothing learned about card 12 transferred to
    card 13.

Both groups are now computed from the things they refer to:

  board actions -- each cell is scored once, and a line's logit is the sum of
    its cells' scores (a static 145x25 incidence matrix) plus a learned bias per
    line length.  Taking three tokens being worth roughly the sum of the three
    is a sound prior, and it costs far fewer parameters than the rows it
    replaces.
  card actions  -- each visible card slot produces a purchase and a reserve
    score from that card's own embedding, scattered to the card's position in
    the action space via the card ids passed alongside the observation.

The remaining 29 indices (deck reserves, wild assignment, phase control,
discards, take-from-opponent, royal choice, pass) keep a small dense head.
"""

from __future__ import annotations

from itertools import pairwise

import torch
from torch import nn

from .action_space import (
    ACTION_SPACE_SIZE,
    OFFSET_CHOOSE_ROYAL,
    OFFSET_DISCARD,
    OFFSET_PASS_MANDATORY,
    OFFSET_PURCHASE_CARD,
    OFFSET_REPLENISH,
    OFFSET_RESERVE_DECK,
    OFFSET_RESERVE_PYRAMID,
    OFFSET_TAKE_FROM_BOARD,
    OFFSET_TAKE_FROM_OPPONENT,
    OFFSET_TAKE_TOKENS,
    OFFSET_USE_PRIVILEGE,
    VALID_LINES,
)
from .state_encoder import (
    BAG_END,
    BAG_START,
    BOARD_CELL_FEATURES,
    BOARD_END,
    BOARD_START,
    CARD_FEATURES,
    CUR_END,
    CUR_START,
    DECK_START,
    MAX_CARD_ID,
    N_BOARD_CELLS,
    N_CARD_SLOTS,
    N_L1,
    N_L2,
    N_PURCHASABLE_SLOTS,
    N_PYRAMID,
    N_PYRAMID_SLOTS,
    N_RESERVED,
    OPP_END,
    OPP_START,
    P_RESERVED_END,
    P_RESERVED_START,
    P_ROYAL_START,
    P_SCALAR_END,
    PENDING_END,
    PHASE_START,
    PLAYER_FEATURES,
    PYRAMID_END,
    PYRAMID_START,
    STATE_DIM,
)

# -- Derived input widths ------------------------------------------------------

_BOARD_IN = BOARD_END - BOARD_START  # 200
_PLAYER_SCALARS = P_SCALAR_END + (PLAYER_FEATURES - P_ROYAL_START)  # 27
_GLOBAL_IN = (BAG_END - BAG_START) + (CUR_START - DECK_START) + (PENDING_END - PHASE_START)  # 33

# -- Branch output dimensions --------------------------------------------------

_CELL_DIM = 32
_BOARD_OUT = 128
_CARD_DIM = 64
_PLAYER_OUT = 64
_GLOBAL_OUT = 64
_TRUNK_IN = _BOARD_OUT + 3 * _CARD_DIM + 2 * _PLAYER_OUT + _GLOBAL_OUT  # 512
_HIDDEN = 256

# -- Action-space segment widths, in index order -------------------------------
# Every logit lands in exactly one of these; the widths must sum to 358.
_N_LINES = len(VALID_LINES)  # 145
_N_PRIV = N_BOARD_CELLS  # 25
_N_TAKE_BOARD = N_BOARD_CELLS  # 25
_MISC_WIDTHS = (
    OFFSET_USE_PRIVILEGE - OFFSET_RESERVE_DECK,  # 8  deck reserve + wild
    OFFSET_DISCARD - OFFSET_REPLENISH,  # 3  replenish/end/skip
    OFFSET_TAKE_FROM_BOARD - OFFSET_DISCARD,  # 7  discards
    OFFSET_CHOOSE_ROYAL - OFFSET_TAKE_FROM_OPPONENT,  # 6  take from opponent
    OFFSET_PASS_MANDATORY - OFFSET_CHOOSE_ROYAL,  # 4  royal choice
    ACTION_SPACE_SIZE - OFFSET_PASS_MANDATORY,  # 1  pass
)
_N_MISC = sum(_MISC_WIDTHS)  # 29


def _mlp(*dims: int) -> nn.Sequential:
    """Linear -> LayerNorm -> ReLU stack.  All layers including the last are activated."""
    layers: list[nn.Module] = []
    for in_d, out_d in pairwise(dims):
        layers += [nn.Linear(in_d, out_d), nn.LayerNorm(out_d), nn.ReLU()]
    return nn.Sequential(*layers)


def _line_incidence() -> torch.Tensor:
    """(145, 25) 0/1 matrix: which board cells make up each TAKE_TOKENS line."""
    inc = torch.zeros(_N_LINES, N_BOARD_CELLS)
    for line_idx, line in enumerate(VALID_LINES):
        for cell in line:
            inc[line_idx, cell] = 1.0
    return inc


class ResBlock(nn.Module):
    """Pre-activation residual block; keeps gradients healthy as depth grows."""

    def __init__(self, width: int) -> None:
        super().__init__()
        self.body = nn.Sequential(
            nn.Linear(width, width),
            nn.LayerNorm(width),
            nn.ReLU(),
            nn.Linear(width, width),
            nn.LayerNorm(width),
        )
        self.act = nn.ReLU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.act(x + self.body(x))


class ActorCriticNet(nn.Module):
    def __init__(
        self,
        trunk_depth: int = 4,
        trunk_width: int = 512,
        dropout: float = 0.0,
    ) -> None:
        super().__init__()
        # Recorded so opponents, evaluation copies and resumed runs can rebuild
        # the same shape instead of assuming the defaults.
        self.arch = {
            "trunk_depth": trunk_depth,
            "trunk_width": trunk_width,
            "dropout": dropout,
        }

        # Board: one shared encoder per cell, used both for trunk context and
        # for the board pointer head.
        self.cell_encoder = _mlp(BOARD_CELL_FEATURES, _CELL_DIM)
        self.board_summary = _mlp(N_BOARD_CELLS * _CELL_DIM, _BOARD_OUT)

        # Shared card encoder -- same weights for pyramid and reserved cards.
        self.card_encoder = _mlp(CARD_FEATURES, _CARD_DIM, _CARD_DIM)

        # Per-player: scalar stats branch (shared between current player and opponent).
        self.player_scalar_enc = _mlp(_PLAYER_SCALARS, _PLAYER_OUT)
        self.player_combiner = _mlp(_PLAYER_OUT + _CARD_DIM, _PLAYER_OUT)

        self.global_encoder = _mlp(_GLOBAL_IN, _GLOBAL_OUT)

        trunk: list[nn.Module] = [
            nn.Linear(_TRUNK_IN, trunk_width),
            nn.LayerNorm(trunk_width),
            nn.ReLU(),
        ]
        if dropout > 0.0:
            trunk.append(nn.Dropout(dropout))
        trunk += [ResBlock(trunk_width) for _ in range(trunk_depth)]
        trunk += [nn.Linear(trunk_width, _HIDDEN), nn.LayerNorm(_HIDDEN), nn.ReLU()]
        self.trunk = nn.Sequential(*trunk)

        # -- Policy heads ------------------------------------------------------
        # Trunk context is projected once to a small vector and broadcast to
        # every cell / card slot, so the per-element heads stay cheap.
        self.head_ctx = nn.Linear(_HIDDEN, 64)
        # Per cell: (take-line score, privilege score, ability-take score)
        self.cell_scores = nn.Sequential(nn.Linear(_CELL_DIM + 64, 64), nn.ReLU(), nn.Linear(64, 3))
        self.line_length_bias = nn.Parameter(torch.zeros(3))
        # Per visible card slot: (purchase score, reserve score)
        self.card_scores = nn.Sequential(nn.Linear(_CARD_DIM + 64, 64), nn.ReLU(), nn.Linear(64, 2))
        self.misc_head = nn.Linear(_HIDDEN, _N_MISC)
        self.value_head = nn.Linear(_HIDDEN, 1)

        inc = _line_incidence()
        self.register_buffer("line_incidence", inc)
        self.register_buffer("line_length_index", (inc.sum(1) - 1).long())

        # Small init on the policy outputs keeps the initial policy near-uniform.
        for layer in (self.cell_scores[-1], self.card_scores[-1], self.misc_head):
            nn.init.orthogonal_(layer.weight, gain=0.01)
            nn.init.constant_(layer.bias, 0.0)
        nn.init.orthogonal_(self.value_head.weight, gain=1.0)
        nn.init.constant_(self.value_head.bias, 0.0)

    # -- Sub-encoders ----------------------------------------------------------

    def _encode_player(self, p: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """
        Encode one player's feature vector.

        Returns (player_vector, reserved_card_embeddings); the per-slot
        embeddings feed the card pointer head.
        """
        scalars = torch.cat([p[..., :P_SCALAR_END], p[..., P_ROYAL_START:]], dim=-1)
        batch = p.shape[:-1]
        reserved = p[..., P_RESERVED_START:P_RESERVED_END].reshape(
            *batch, N_RESERVED, CARD_FEATURES
        )
        res_emb = self.card_encoder(reserved)  # (..., 3, _CARD_DIM)
        # Max-pool so a single high-value reserved card dominates the summary.
        h_res = res_emb.max(dim=-2).values
        h_sc = self.player_scalar_enc(scalars)
        return self.player_combiner(torch.cat([h_sc, h_res], dim=-1)), res_emb

    # -- Policy assembly -------------------------------------------------------

    def _scatter_card_scores(self, scores: torch.Tensor, card_ids: torch.Tensor) -> torch.Tensor:
        """
        Route per-slot scores to their card ids, producing a (batch, 67) segment.

        Slots holding no card (id 0) are routed to a trailing bin that is then
        discarded.  Card ids not on the table keep a 0 logit; they are always
        illegal, so the action mask removes them before the softmax.
        """
        batch = scores.shape[0]
        buf = scores.new_zeros(batch, MAX_CARD_ID + 1)
        valid = card_ids > 0
        index = torch.where(valid, (card_ids - 1).clamp(min=0), MAX_CARD_ID)
        buf.scatter_(1, index, torch.where(valid, scores, torch.zeros_like(scores)))
        return buf[:, :MAX_CARD_ID]

    # -- Forward ---------------------------------------------------------------

    def forward(
        self, obs: torch.Tensor, card_ids: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """
        Args:
            obs:      float tensor of shape (batch, STATE_DIM)
            card_ids: long tensor of shape (batch, N_CARD_SLOTS); 0 = empty slot
        Returns:
            logits: (batch, ACTION_SPACE_SIZE)  -- raw, unmasked
            value:  (batch, 1)
        """
        assert obs.dim() == 2, "ActorCriticNet expects a batched observation"
        batch = obs.shape[0]

        cells = obs[:, BOARD_START:BOARD_END].reshape(batch, N_BOARD_CELLS, BOARD_CELL_FEATURES)
        cell_emb = self.cell_encoder(cells)  # (b, 25, _CELL_DIM)
        h_board = self.board_summary(cell_emb.reshape(batch, -1))

        pyr = obs[:, PYRAMID_START:PYRAMID_END].reshape(batch, N_PYRAMID, CARD_FEATURES)
        pyr_emb = self.card_encoder(pyr)  # (b, 12, _CARD_DIM)
        h_l1 = pyr_emb[:, :N_L1].sum(1)
        h_l2 = pyr_emb[:, N_L1 : N_L1 + N_L2].sum(1)
        h_l3 = pyr_emb[:, N_L1 + N_L2 :].sum(1)

        h_cur, cur_res_emb = self._encode_player(obs[:, CUR_START:CUR_END])
        h_opp, opp_res_emb = self._encode_player(obs[:, OPP_START:OPP_END])

        global_ctx = torch.cat(
            [
                obs[:, BAG_START:BAG_END],
                obs[:, DECK_START:CUR_START],
                obs[:, PHASE_START:PENDING_END],
            ],
            dim=-1,
        )
        h_global = self.global_encoder(global_ctx)

        h = self.trunk(torch.cat([h_board, h_l1, h_l2, h_l3, h_cur, h_opp, h_global], dim=-1))
        ctx = self.head_ctx(h)

        # Board-addressed logits, computed from the cells they name.
        cell_ctx = ctx.unsqueeze(1).expand(-1, N_BOARD_CELLS, -1)
        cell_out = self.cell_scores(torch.cat([cell_emb, cell_ctx], dim=-1))  # (b, 25, 3)
        line_logits = (
            torch.einsum("lc,bc->bl", self.line_incidence, cell_out[..., 0])
            + self.line_length_bias[self.line_length_index]
        )
        priv_logits = cell_out[..., 1]
        take_logits = cell_out[..., 2]

        # Card-addressed logits, computed from each visible card's embedding.
        slot_emb = torch.cat([pyr_emb, cur_res_emb, opp_res_emb], dim=1)  # (b, 18, _CARD_DIM)
        slot_ctx = ctx.unsqueeze(1).expand(-1, N_CARD_SLOTS, -1)
        slot_out = self.card_scores(torch.cat([slot_emb, slot_ctx], dim=-1))  # (b, 18, 2)
        # Purchase is legal from the pyramid and the player's own reserved cards;
        # reserve-from-pyramid only from the pyramid.
        purchase_logits = self._scatter_card_scores(
            slot_out[:, :N_PURCHASABLE_SLOTS, 0], card_ids[:, :N_PURCHASABLE_SLOTS]
        )
        reserve_logits = self._scatter_card_scores(
            slot_out[:, :N_PYRAMID_SLOTS, 1], card_ids[:, :N_PYRAMID_SLOTS]
        )

        misc = self.misc_head(h).split(_MISC_WIDTHS, dim=-1)

        logits = torch.cat(
            [
                line_logits,  # [0:145]     TAKE_TOKENS
                purchase_logits,  # [145:212]   PURCHASE_CARD
                reserve_logits,  # [212:279]   RESERVE_CARD_FROM_PYRAMID
                misc[0],  # [279:287]   reserve from deck + assign wild
                priv_logits,  # [287:312]   USE_PRIVILEGE
                misc[1],  # [312:315]   replenish / end optional / skip
                misc[2],  # [315:322]   DISCARD_TOKENS
                take_logits,  # [322:347]   TAKE_TOKEN_FROM_BOARD
                misc[3],  # [347:353]   TAKE_TOKEN_FROM_OPPONENT
                misc[4],  # [353:357]   CHOOSE_ROYAL_CARD
                misc[5],  # [357:358]   PASS_MANDATORY
            ],
            dim=-1,
        )

        return logits, self.value_head(h)

    def masked_policy(
        self,
        obs: torch.Tensor,
        card_ids: torch.Tensor,
        legal_mask: torch.Tensor,
    ) -> torch.distributions.Categorical:
        """Returns a Categorical distribution over legal actions."""
        logits, _ = self.forward(obs, card_ids)
        return torch.distributions.Categorical(
            logits=logits.masked_fill(~legal_mask, float("-inf"))
        )


def new_like(model: ActorCriticNet) -> ActorCriticNet:
    """An untrained network with the same shape as `model`, on the same device."""
    return ActorCriticNet(**model.arch).to(next(model.parameters()).device)


def build_from_checkpoint(ckpt: dict) -> ActorCriticNet:
    """
    Construct a network matching the architecture a checkpoint was saved with.

    Checkpoints written before the trunk became configurable carry no "arch"
    key; those all used the current defaults.
    """
    return ActorCriticNet(**ckpt.get("arch", {}))


# Guards against a layout change silently breaking the policy assembly.
assert PENDING_END == STATE_DIM, "global context slice must reach the end of the observation"
assert (
    _N_LINES + 2 * MAX_CARD_ID + _N_PRIV + _N_TAKE_BOARD + _N_MISC == ACTION_SPACE_SIZE
), "policy head segments must tile the action space exactly"
assert OFFSET_TAKE_TOKENS == 0 and OFFSET_PURCHASE_CARD == _N_LINES, "action layout moved"
assert OFFSET_RESERVE_PYRAMID == OFFSET_PURCHASE_CARD + MAX_CARD_ID, "action layout moved"
