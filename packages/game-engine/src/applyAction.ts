/**
 * The checked entry point to the engine.
 *
 * `reducer` signals "I did not apply that" by returning the same state object.
 * That is a fine internal convention, but it made every caller reimplement the
 * same two-step dance — validate the shape, then compare references — and
 * leaked an engine implementation detail into the transport layer. The server
 * reported every rejection as a bare "Invalid action", and the AI sim could not
 * distinguish an illegal move from a move that legitimately changed nothing.
 *
 * `applyAction` is that dance done once, in the package that owns the rules,
 * returning a result the caller can act on and a reason it can show a player.
 *
 * On the reason: it is derived after the fact rather than reported from the
 * rejection site inside the reducer. Threading a reason out of all ~40 rejection
 * points would be a large mechanical change to the most safety-critical file in
 * the project, for a message. Deriving it here covers the cases a client
 * actually hits and keeps the reducer untouched.
 */

import type { Action, GameState } from './types';
import { reducer } from './reducer';
import { legalMoves } from './legalMoves';
import { validateAction } from './validateAction';
import { canAfford, MAX_RESERVED, totalTokens, MAX_TOKENS, unlockedColors } from './helpers';

export type ActionRejection =
  /** The payload is not a well-formed Action — wrong shape, unknown colour, bad index. */
  | { kind: 'malformed'; reason: string }
  /** A well-formed Action that the rules do not allow in the current state. */
  | { kind: 'illegal'; reason: string };

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; error: ActionRejection };

const PHASE_LABEL: Record<GameState['phase'], string> = {
  optional_privilege: 'the optional privilege step',
  optional_replenish: 'the optional replenish step',
  mandatory: 'the main action step',
  choose_royal: 'choosing a royal card',
  resolve_ability: 'resolving a card ability',
  assign_wild: 'assigning a wild colour',
  discard: 'discarding down to 10 tokens',
  game_over: 'the finished game',
};

/** Action types the engine will consider at all during each phase. */
const PHASE_ACTIONS: Record<GameState['phase'], ReadonlySet<Action['type']>> = {
  optional_privilege: new Set(['USE_PRIVILEGE', 'END_OPTIONAL_PHASE', 'SKIP_TO_MANDATORY']),
  optional_replenish: new Set(['REPLENISH_BOARD', 'END_OPTIONAL_PHASE', 'SKIP_TO_MANDATORY']),
  mandatory: new Set([
    'TAKE_TOKENS', 'RESERVE_CARD_FROM_PYRAMID', 'RESERVE_CARD_FROM_DECK',
    'PURCHASE_CARD', 'REPLENISH_BOARD', 'PASS_MANDATORY',
  ]),
  choose_royal: new Set(['CHOOSE_ROYAL_CARD']),
  resolve_ability: new Set(['TAKE_TOKEN_FROM_BOARD', 'TAKE_TOKEN_FROM_OPPONENT']),
  assign_wild: new Set(['ASSIGN_WILD_COLOR']),
  discard: new Set(['DISCARD_TOKENS']),
  game_over: new Set([]),
};

/**
 * Best-effort explanation of why a well-formed action was not applied.
 *
 * Ordered most-specific first, so a player gets "you cannot afford that card"
 * rather than the generic fallback whenever the engine can tell.
 */
function explainRejection(state: GameState, action: Action): string {
  if (state.phase === 'game_over') return 'The game is over.';

  if (!PHASE_ACTIONS[state.phase].has(action.type)) {
    return `That action is not available during ${PHASE_LABEL[state.phase]}.`;
  }

  const player = state.players[state.currentPlayer];

  switch (action.type) {
    case 'PURCHASE_CARD': {
      const inPyramid = [
        ...state.pyramid.level1, ...state.pyramid.level2, ...state.pyramid.level3,
      ].find(card => card.id === action.cardId);
      const reserved = player.reservedCards.find(card => card.id === action.cardId);
      const card = inPyramid ?? reserved;
      if (!card) return 'That card is not in the pyramid or your reserve.';

      const isWild = card.ability === 'wild' || card.ability === 'wild and turn';
      if (isWild && unlockedColors(player).size === 0) {
        return 'You need a card with a colour before you can buy a wild card.';
      }
      if (!canAfford(card, player, action.goldUsage)) {
        return 'You cannot afford that card with those tokens.';
      }
      return 'That purchase is not legal right now.';
    }

    case 'RESERVE_CARD_FROM_PYRAMID':
    case 'RESERVE_CARD_FROM_DECK': {
      if (player.reservedCards.length >= MAX_RESERVED) {
        return `You already have ${MAX_RESERVED} reserved cards.`;
      }
      if (!state.board.some(cell => cell === 'gold')) {
        return 'Reserving takes a gold token, and there is none on the board.';
      }
      if (action.type === 'RESERVE_CARD_FROM_DECK') {
        return 'That deck is empty.';
      }
      return 'That card is not in the pyramid.';
    }

    case 'TAKE_TOKENS': {
      const cells = action.indices.map(index => state.board[index]);
      if (cells.some(cell => cell === null)) return 'One of those spaces is empty.';
      if (cells.some(cell => cell === 'gold')) return 'Gold cannot be taken this way — reserve a card instead.';
      return 'Tokens must form one unbroken straight line of up to three.';
    }

    case 'USE_PRIVILEGE': {
      if (player.privileges < 1) return 'You have no privilege scrolls to spend.';
      const cell = state.board[action.index];
      if (cell === null) return 'That space is empty.';
      if (cell === 'gold') return 'A privilege cannot take gold.';
      return 'That privilege use is not legal right now.';
    }

    case 'REPLENISH_BOARD': {
      if (totalTokens(state.bag) === 0) return 'The bag is empty.';
      return 'You can only replenish before acting, or when no action is possible.';
    }

    case 'PASS_MANDATORY':
      return 'You must take tokens, reserve or purchase — passing is only for a deadlock.';

    case 'DISCARD_TOKENS': {
      if (player.tokens[action.color] < 1) return 'You have none of those to discard.';
      if (totalTokens(player.tokens) <= MAX_TOKENS) return 'You are already within the token limit.';
      return 'That discard is not legal right now.';
    }

    case 'TAKE_TOKEN_FROM_OPPONENT': {
      if (state.pendingAbility !== 'Take') return 'No steal is pending.';
      if (action.color === 'gold') return 'Gold cannot be stolen.';
      return 'Your opponent has none of those.';
    }

    case 'TAKE_TOKEN_FROM_BOARD': {
      if (state.pendingAbility !== 'Token') return 'No token ability is pending.';
      return 'That space does not hold a token of the card’s colour.';
    }

    case 'ASSIGN_WILD_COLOR':
      return 'You must choose a colour you already own on another card.';

    case 'CHOOSE_ROYAL_CARD':
      return 'That royal card is not available.';

    default:
      return 'That move is not legal right now.';
  }
}

/**
 * Validates, applies, and reports.
 *
 * A successful result always carries a state that differs from the input: the
 * engine has no action that legitimately leaves the state untouched, so callers
 * can treat `ok: true` as "something happened".
 */
export function applyAction(state: GameState, action: unknown): ActionResult {
  const validated = validateAction(action);
  if (!validated.valid) {
    return { ok: false, error: { kind: 'malformed', reason: validated.error.reason } };
  }

  const next = reducer(state, validated.action);
  if (next === state) {
    return { ok: false, error: { kind: 'illegal', reason: explainRejection(state, validated.action) } };
  }

  return { ok: true, state: next };
}

/** True when the action is one `legalMoves` currently offers. */
export function isLegalMove(state: GameState, action: Action): boolean {
  const key = JSON.stringify(action);
  return legalMoves(state).some(move => JSON.stringify(move) === key);
}
