/**
 * Structural validation for actions arriving from outside the engine.
 *
 * The reducer validates *game rules* — is it this player's phase, can they
 * afford the card, is that line of tokens legal. It assumes the action itself
 * is well-formed. That assumption holds for actions produced by `legalMoves`,
 * but not for actions parsed from a WebSocket frame or an HTTP body, where the
 * payload is whatever the peer sent.
 *
 * Validating shape here keeps the two concerns separate: this module answers
 * "is this an Action at all?", the reducer answers "is this Action legal now?".
 * Every trust boundary (the multiplayer server, the AI sim's HTTP routes) must
 * call `validateAction` before `reducer`.
 *
 * Why it matters concretely: an unknown token color such as `'notacolor'` used
 * to pass the reducer's `tokens[color] < 1` guard, because `undefined < 1` is
 * false. The reducer then wrote `undefined - 1` into the pool, putting `NaN`
 * into a player's tokens and the bag — silently, since the conservation helpers
 * only sum known colors. The reducer also reported the action as *applied*,
 * so the corrupt state was broadcast to both players.
 */

import type { Action, GemColor, TokenColor } from './types';
import { BOARD_SIZE } from './helpers';
import { GEM_COLORS, TOKEN_COLORS, MAX_TOKENS_IN_LINE } from './helpers';

/** Why an action was rejected. Safe to show a client: it describes shape, not hidden state. */
export interface ActionValidationError {
  reason: string;
}

export type ActionValidationResult =
  | { valid: true; action: Action }
  | { valid: false; error: ActionValidationError };

// ─── Primitive guards ─────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoardIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < BOARD_SIZE;
}

function isTokenColor(value: unknown): value is TokenColor {
  return typeof value === 'string' && (TOKEN_COLORS as string[]).includes(value);
}

function isGemColor(value: unknown): value is GemColor {
  return typeof value === 'string' && (GEM_COLORS as string[]).includes(value);
}

function isCardId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * A count that may appear in a cost or gold allocation: a non-negative integer.
 * `NaN` and `Infinity` fail `Number.isInteger`, so arithmetic on validated
 * payloads can never produce a non-finite token count.
 */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

// ─── Per-action validation ────────────────────────────────────────────────────

function invalid(reason: string): ActionValidationResult {
  return { valid: false, error: { reason } };
}

/**
 * Returns the action narrowed to `Action` when it is structurally well-formed,
 * or a reason why not. Rule legality is not checked — pass the result to the
 * reducer, which returns the state unchanged if the move is illegal.
 */
export function validateAction(action: unknown): ActionValidationResult {
  if (!isPlainObject(action)) return invalid('Action must be an object');
  const { type } = action;
  if (typeof type !== 'string') return invalid('Action type must be a string');

  switch (type) {
    case 'END_OPTIONAL_PHASE':
    case 'SKIP_TO_MANDATORY':
    case 'REPLENISH_BOARD':
    case 'PASS_MANDATORY':
      return { valid: true, action: { type } as Action };

    case 'USE_PRIVILEGE': {
      if (!isBoardIndex(action.index)) {
        return invalid(`USE_PRIVILEGE needs an integer board index in 0..${BOARD_SIZE - 1}`);
      }
      return { valid: true, action: { type, index: action.index } };
    }

    case 'TAKE_TOKENS': {
      const { indices } = action;
      if (!Array.isArray(indices)) return invalid('TAKE_TOKENS needs an indices array');
      if (indices.length < 1 || indices.length > MAX_TOKENS_IN_LINE) {
        return invalid(`TAKE_TOKENS needs 1..${MAX_TOKENS_IN_LINE} indices`);
      }
      if (!indices.every(isBoardIndex)) {
        return invalid(`TAKE_TOKENS indices must be integers in 0..${BOARD_SIZE - 1}`);
      }
      if (new Set(indices).size !== indices.length) {
        return invalid('TAKE_TOKENS indices must be distinct');
      }
      return { valid: true, action: { type, indices: [...indices] } };
    }

    case 'RESERVE_CARD_FROM_PYRAMID': {
      if (!isCardId(action.cardId)) return invalid('RESERVE_CARD_FROM_PYRAMID needs a positive integer cardId');
      return { valid: true, action: { type, cardId: action.cardId } };
    }

    case 'RESERVE_CARD_FROM_DECK': {
      const { source } = action;
      if (source !== 'deck_1' && source !== 'deck_2' && source !== 'deck_3') {
        return invalid('RESERVE_CARD_FROM_DECK source must be deck_1, deck_2 or deck_3');
      }
      return { valid: true, action: { type, source } };
    }

    case 'PURCHASE_CARD': {
      if (!isCardId(action.cardId)) return invalid('PURCHASE_CARD needs a positive integer cardId');
      const { goldUsage } = action;
      if (goldUsage !== undefined && !isPlainObject(goldUsage)) {
        return invalid('PURCHASE_CARD goldUsage must be an object');
      }
      // Rebuild the allocation from recognised keys only: an unknown key cannot
      // reach the reducer's deduction arithmetic, and a non-integer amount
      // cannot put NaN into a token pool.
      const cleanGoldUsage: Partial<Record<GemColor | 'pearl', number>> = {};
      for (const [color, amount] of Object.entries(goldUsage ?? {})) {
        if (!isGemColor(color) && color !== 'pearl') {
          return invalid(`PURCHASE_CARD goldUsage has unknown color "${color}"`);
        }
        if (!isCount(amount)) {
          return invalid(`PURCHASE_CARD goldUsage for "${color}" must be a non-negative integer`);
        }
        cleanGoldUsage[color] = amount;
      }
      return { valid: true, action: { type, cardId: action.cardId, goldUsage: cleanGoldUsage } };
    }

    case 'CHOOSE_ROYAL_CARD': {
      if (!isCardId(action.cardId)) return invalid('CHOOSE_ROYAL_CARD needs a positive integer cardId');
      return { valid: true, action: { type, cardId: action.cardId } };
    }

    case 'TAKE_TOKEN_FROM_BOARD': {
      if (!isBoardIndex(action.index)) {
        return invalid(`TAKE_TOKEN_FROM_BOARD needs an integer board index in 0..${BOARD_SIZE - 1}`);
      }
      return { valid: true, action: { type, index: action.index } };
    }

    case 'TAKE_TOKEN_FROM_OPPONENT': {
      if (!isTokenColor(action.color)) {
        return invalid('TAKE_TOKEN_FROM_OPPONENT needs a known token color');
      }
      return { valid: true, action: { type, color: action.color } };
    }

    case 'ASSIGN_WILD_COLOR': {
      if (!isCardId(action.wildCardId)) return invalid('ASSIGN_WILD_COLOR needs a positive integer wildCardId');
      if (!isGemColor(action.color)) return invalid('ASSIGN_WILD_COLOR needs a gem color');
      return { valid: true, action: { type, wildCardId: action.wildCardId, color: action.color } };
    }

    case 'DISCARD_TOKENS': {
      if (!isTokenColor(action.color)) return invalid('DISCARD_TOKENS needs a known token color');
      return { valid: true, action: { type, color: action.color } };
    }

    default:
      return invalid(`Unknown action type "${type}"`);
  }
}
