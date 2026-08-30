"""
Self-play data collection.

Collection is driven by a **transition budget**, not an episode count, and games
persist across iterations.  Asking for a fixed number of episodes drains the
slot pool towards the end of every iteration: measured at 40 episodes over 32
envs, the mean step batch was 18.7/32 and only 46% of rounds were at least
three-quarters full.  Since a policy forward costs 1319 us/row at batch 1 but
41.7 us/row at batch 64, those thin tail rounds are disproportionately
expensive.  Running to a transition budget and never draining keeps every round
at full width.

Games that are still in flight when the budget is reached are cut into a
segment: the partial episode is returned with a bootstrapped terminal value, and
the same game continues in the next call.  Nothing is discarded and the
opening/endgame mix stays representative, which resetting every iteration would
skew towards openings.

Opponent pool
-------------
Training only against the current policy is the classic setup for strategy
cycling: the agent can get better at beating itself while getting worse in
absolute terms, because whatever the opponent has stopped punishing is free to
rot.  With a pool, some fraction of games seat a frozen past checkpoint
opposite the learner.

Transitions played by a frozen opponent are marked trainable=False.  They stay
in the trajectory -- GAE needs an unbroken chain and their states are still
valid value targets -- but the policy loss skips them, because their actions
did not come from the policy being optimised.  The learner's value head is
evaluated on *every* state, including opponent-played ones, so the whole GAE
chain speaks in one value function.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field

import numpy as np
import torch

from .env import VecSplendorDuelEnv
from .model import ActorCriticNet, new_like

MAX_STEPS_PER_EPISODE = 2_000


@dataclass
class Transition:
    obs: np.ndarray           # (STATE_DIM,)
    card_ids: np.ndarray      # (N_CARD_SLOTS,) -- routes the card pointer head
    action: int
    log_prob: float
    value: float              # always the learner's value estimate
    reward: float
    done: bool
    legal_mask: np.ndarray    # (ACTION_SPACE_SIZE,)
    player_id: int            # 0 or 1 -- index of the player who acted
    trainable: bool = True    # False when a frozen pool opponent chose this action


@dataclass
class Episode:
    """
    One trajectory segment.

    A segment ends either because the game ended (done=True on the last
    transition) or because the collection budget ran out mid-game, in which case
    terminal_value carries the bootstrap and the game continues in the next call.
    """
    transitions: list[Transition] = field(default_factory=list)
    # Value estimate for the state after the last transition.  Non-zero only for
    # segments cut by the collection budget or the step cap.
    terminal_value: float = 0.0
    # Player whose turn it is AFTER the last transition (used to correct
    # perspective when bootstrapping terminal_value into GAE).
    terminal_player_id: int = 0
    # 'prestige', 'crowns', 'color_prestige', or None for unfinished segments.
    win_condition: str | None = None
    # Seat the learner occupied; None for pure self-play games.
    learner_seat: int | None = None
    # True when the learner won.  None unless this segment ended a pool game.
    learner_won: bool | None = None

    def __len__(self) -> int:
        return len(self.transitions)


class OpponentPool:
    """
    Bounded FIFO of past model snapshots, kept on CPU.

    Snapshots are state dicts rather than live modules: the pool may hold many
    more entries than are ever instantiated at once, and only a handful get
    materialised per collection call.
    """

    def __init__(self, max_size: int = 8) -> None:
        assert max_size >= 1
        self.max_size = max_size
        self._snapshots: list[dict] = []

    def add(self, model: ActorCriticNet) -> None:
        snapshot = {k: v.detach().to("cpu").clone() for k, v in model.state_dict().items()}
        self._snapshots.append(snapshot)
        if len(self._snapshots) > self.max_size:
            self._snapshots.pop(0)

    def sample(self, rng: np.random.Generator) -> dict | None:
        if not self._snapshots:
            return None
        return self._snapshots[int(rng.integers(len(self._snapshots)))]

    def state_dicts(self) -> list[dict]:
        return [copy.deepcopy(s) for s in self._snapshots]

    def load(self, snapshots: list[dict]) -> None:
        self._snapshots = list(snapshots)[-self.max_size :]

    def __len__(self) -> int:
        return len(self._snapshots)


@dataclass
class _SlotRun:
    """Bookkeeping for the game currently occupying one env slot."""
    episode: Episode
    steps: int = 0            # decisions in the current GAME, across segments
    # None = self-play (learner drives both seats); otherwise the seat the
    # learner occupies, with the other seat driven by `opponent`.
    learner_seat: int | None = None
    opponent: ActorCriticNet | None = None


class RolloutCollector:
    """
    Owns the vectorized env and the games running inside it.

    State persists across calls to `collect`, which is what lets a game span
    several iterations instead of restarting each time.
    """

    def __init__(
        self,
        model: ActorCriticNet,
        env: VecSplendorDuelEnv,
        device: torch.device | None = None,
        opponent_pool: OpponentPool | None = None,
        n_opponent_instances: int = 2,
        rng: np.random.Generator | None = None,
    ) -> None:
        self.model = model
        self.env = env
        self.device = device or next(model.parameters()).device
        self.opponent_pool = opponent_pool
        self.n_opponent_instances = n_opponent_instances
        self.rng = rng or np.random.default_rng()

        self._runs: list[_SlotRun] = []
        self._opponents: list[ActorCriticNet] = []
        self._seat_counter = 0
        self._started = False

    # -- Opponent handling -----------------------------------------------------

    def _refresh_opponents(self, opponent_prob: float) -> None:
        """Re-draw the frozen opponents used by games started in this call."""
        pool = self.opponent_pool
        if pool is None or len(pool) == 0 or opponent_prob <= 0.0:
            self._opponents = []
            return
        self._opponents = []
        for _ in range(min(self.n_opponent_instances, len(pool))):
            snapshot = pool.sample(self.rng)
            assert snapshot is not None
            net = new_like(self.model)
            net.load_state_dict(snapshot)
            net.eval()
            self._opponents.append(net)

    def _assign(self, slot: int, opponent_prob: float) -> None:
        """Configure a freshly reset slot: pure self-play, or learner vs a pool opponent."""
        run = _SlotRun(episode=Episode())
        if self._opponents and self.rng.random() < opponent_prob:
            run.learner_seat = self._seat_counter % 2
            self._seat_counter += 1
            run.opponent = self._opponents[int(self.rng.integers(len(self._opponents)))]
            run.episode.learner_seat = run.learner_seat
        self._runs[slot] = run

    # -- Collection ------------------------------------------------------------

    @torch.inference_mode()
    def collect(self, min_transitions: int, opponent_prob: float = 0.0) -> list[Episode]:
        """
        Play until at least `min_transitions` transitions have been gathered.

        Returns the trajectory segments produced, in completion order.
        """
        assert min_transitions > 0
        model = self.model
        env = self.env
        model.eval()

        self._refresh_opponents(opponent_prob)

        if not self._started:
            env.reset_all()
            self._runs = [_SlotRun(episode=Episode()) for _ in range(env.n_envs)]
            for slot in range(env.n_envs):
                self._assign(slot, opponent_prob)
            self._started = True

        finished: list[Episode] = []
        collected = 0

        while collected < min_transitions:
            active = env.active_slots()
            if not active:
                # Every slot ended in the same round; restart them together.
                env.reset_slots(list(range(env.n_envs)))
                for slot in range(env.n_envs):
                    self._assign(slot, opponent_prob)
                continue

            obs_np = env.obs[active]
            mask_np = env.masks[active]
            ids_np = env.card_ids[active]

            if not mask_np.any(axis=1).all():
                bad = active[int(np.flatnonzero(~mask_np.any(axis=1))[0])]
                raise RuntimeError(
                    "legal_mask is all-False -- no legal action could be mapped to a "
                    f"canonical index in slot {bad}.\n"
                    f"  legal_moves from server: {env.slots[bad].legal_moves}"
                )

            obs_t = torch.from_numpy(obs_np).to(self.device)
            mask_t = torch.from_numpy(mask_np).to(self.device)
            ids_t = torch.from_numpy(ids_np).to(self.device)

            # One learner pass over every active row: it supplies the value
            # estimate for the whole GAE chain, and the action for every
            # learner-driven seat.
            logits, values = model(obs_t, ids_t)
            dist = torch.distributions.Categorical(
                logits=logits.masked_fill(~mask_t, float("-inf"))
            )
            sampled = dist.sample()
            actions_np = sampled.cpu().numpy()
            log_probs_np = dist.log_prob(sampled).cpu().numpy()
            values_np = values.squeeze(-1).cpu().numpy()
            trainable = np.ones(len(active), dtype=bool)

            # Rows where a frozen opponent is on turn: overwrite the action with
            # its own choice and drop the row from the policy loss.
            for opponent in self._opponents:
                rows = [
                    pos
                    for pos, slot in enumerate(active)
                    if self._runs[slot].opponent is opponent
                    and env.slots[slot].current_player != self._runs[slot].learner_seat
                ]
                if not rows:
                    continue
                sel = torch.as_tensor(rows, device=self.device)
                opp_logits, _ = opponent(obs_t[sel], ids_t[sel])
                opp_dist = torch.distributions.Categorical(
                    logits=opp_logits.masked_fill(~mask_t[sel], float("-inf"))
                )
                actions_np[rows] = opp_dist.sample().cpu().numpy()
                log_probs_np[rows] = 0.0
                trainable[rows] = False

            actors = [env.slots[slot].current_player for slot in active]
            obs_snapshot = obs_np.copy()
            mask_snapshot = mask_np.copy()
            ids_snapshot = ids_np.copy()

            results = env.step(active, [int(a) for a in actions_np])
            collected += len(active)

            to_reset: list[int] = []
            for pos, slot in enumerate(active):
                result = results[slot]
                run = self._runs[slot]
                run.steps += 1
                run.episode.transitions.append(
                    Transition(
                        obs=obs_snapshot[pos],
                        card_ids=ids_snapshot[pos],
                        action=int(actions_np[pos]),
                        log_prob=float(log_probs_np[pos]),
                        value=float(values_np[pos]),
                        reward=result.reward,
                        done=result.done,
                        legal_mask=mask_snapshot[pos],
                        player_id=actors[pos],
                        trainable=bool(trainable[pos]),
                    )
                )

                capped = not result.done and run.steps >= MAX_STEPS_PER_EPISODE
                if not (result.done or capped):
                    continue

                if result.done:
                    run.episode.win_condition = result.win_condition
                    if run.learner_seat is not None:
                        run.episode.learner_won = result.winner == run.learner_seat
                else:
                    self._bootstrap(run.episode, slot)
                finished.append(run.episode)
                to_reset.append(slot)

            if to_reset:
                env.reset_slots(to_reset)
                for slot in to_reset:
                    self._assign(slot, opponent_prob)

        # Cut every in-flight game into a segment and keep it running.
        for slot, run in enumerate(self._runs):
            if not run.episode.transitions:
                continue
            self._bootstrap(run.episode, slot)
            finished.append(run.episode)
            run.episode = Episode(learner_seat=run.learner_seat)

        return finished

    @torch.inference_mode()
    def _bootstrap(self, episode: Episode, slot: int) -> None:
        """Attach a value estimate for the state following the segment's last transition."""
        env = self.env
        episode.terminal_player_id = env.slots[slot].current_player
        obs_t = torch.from_numpy(env.obs[slot]).to(self.device).unsqueeze(0)
        ids_t = torch.from_numpy(env.card_ids[slot]).to(self.device).unsqueeze(0)
        _, value = self.model(obs_t, ids_t)
        episode.terminal_value = float(value.item())
