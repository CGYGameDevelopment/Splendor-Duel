import type { Action, GameState } from '@splendor-duel/game-engine';
import { legalMoves } from '@splendor-duel/game-engine';
import type { ClientGameState } from '@splendor-duel/protocol';

type TakeTokensAction = Extract<Action, { type: 'TAKE_TOKENS' }>;

export interface LegalMovesIndex {
  all: readonly Action[];
  takeTokenLines: readonly TakeTokensAction[];
  purchaseByCard: ReadonlyMap<number, readonly Action[]>;
  reservePyramidByCard: ReadonlyMap<number, Action>;
  reserveDeckBySource: ReadonlyMap<string, Action>;
  privilegeByCell: ReadonlyMap<number, Action>;
  takeBoardByCell: ReadonlyMap<number, Action>;
  takeOpponentByColor: ReadonlyMap<string, Action>;
  chooseRoyalById: ReadonlyMap<number, Action>;
  /** Wild assignment is for a single specific wild card per assign_wild phase, so color is a unique key. */
  assignWildByColor: ReadonlyMap<string, Action>;
  discardByColor: ReadonlyMap<string, Action>;
  endOptional: Action | null;
  skipToMandatory: Action | null;
  passMandatory: Action | null;
  replenish: Action | null;
  hasPrivilege: boolean;
}

function emptyIndex(): LegalMovesIndex {
  return {
    all: [],
    takeTokenLines: [],
    purchaseByCard: new Map(),
    reservePyramidByCard: new Map(),
    reserveDeckBySource: new Map(),
    privilegeByCell: new Map(),
    takeBoardByCell: new Map(),
    takeOpponentByColor: new Map(),
    chooseRoyalById: new Map(),
    assignWildByColor: new Map(),
    discardByColor: new Map(),
    endOptional: null,
    skipToMandatory: null,
    passMandatory: null,
    replenish: null,
    hasPrivilege: false,
  };
}

export const EMPTY_LEGAL_INDEX: LegalMovesIndex = emptyIndex();

/**
 * Build a single index of all legal moves for the current state, keyed for
 * O(1) lookup by the various UI affordances. Computing this once per state
 * avoids re-running `legalMoves` from each component on every render.
 *
 * Returns an empty index when it is not the viewer's turn — affordances are
 * only ever offered to the active player.
 *
 * The cast to GameState is safe: `legalMoves` only reads the current player's
 * full data, which is always present in the client view sent to that player.
 */
export function buildLegalMovesIndex(
  state: ClientGameState | null,
  isMyTurn: boolean,
): LegalMovesIndex {
  if (!state || !isMyTurn) return EMPTY_LEGAL_INDEX;

  const all = legalMoves(state as unknown as GameState);
  const takeTokenLines: TakeTokensAction[] = [];
  const purchaseByCard = new Map<number, Action[]>();
  const reservePyramidByCard = new Map<number, Action>();
  const reserveDeckBySource = new Map<string, Action>();
  const privilegeByCell = new Map<number, Action>();
  const takeBoardByCell = new Map<number, Action>();
  const takeOpponentByColor = new Map<string, Action>();
  const chooseRoyalById = new Map<number, Action>();
  const assignWildByColor = new Map<string, Action>();
  const discardByColor = new Map<string, Action>();
  let endOptional: Action | null = null;
  let skipToMandatory: Action | null = null;
  let passMandatory: Action | null = null;
  let replenish: Action | null = null;
  let hasPrivilege = false;

  for (const m of all) {
    switch (m.type) {
      case 'TAKE_TOKENS':
        takeTokenLines.push(m);
        break;
      case 'PURCHASE_CARD': {
        const arr = purchaseByCard.get(m.cardId);
        if (arr) arr.push(m);
        else purchaseByCard.set(m.cardId, [m]);
        break;
      }
      case 'RESERVE_CARD_FROM_PYRAMID':
        reservePyramidByCard.set(m.cardId, m);
        break;
      case 'RESERVE_CARD_FROM_DECK':
        reserveDeckBySource.set(m.source, m);
        break;
      case 'USE_PRIVILEGE':
        hasPrivilege = true;
        if (m.indices.length === 1) privilegeByCell.set(m.indices[0], m);
        break;
      case 'TAKE_TOKEN_FROM_BOARD':
        takeBoardByCell.set(m.index, m);
        break;
      case 'TAKE_TOKEN_FROM_OPPONENT':
        takeOpponentByColor.set(m.color, m);
        break;
      case 'CHOOSE_ROYAL_CARD':
        chooseRoyalById.set(m.cardId, m);
        break;
      case 'ASSIGN_WILD_COLOR':
        assignWildByColor.set(m.color, m);
        break;
      case 'DISCARD_TOKENS': {
        const tokens = m.tokens as Record<string, number>;
        for (const c of Object.keys(tokens)) {
          if (tokens[c] === 1) discardByColor.set(c, m);
        }
        break;
      }
      case 'END_OPTIONAL_PHASE':
        endOptional = m;
        break;
      case 'SKIP_TO_MANDATORY':
        skipToMandatory = m;
        break;
      case 'PASS_MANDATORY':
        passMandatory = m;
        break;
      case 'REPLENISH_BOARD':
        replenish = m;
        break;
    }
  }

  return {
    all,
    takeTokenLines,
    purchaseByCard,
    reservePyramidByCard,
    reserveDeckBySource,
    privilegeByCell,
    takeBoardByCell,
    takeOpponentByColor,
    chooseRoyalById,
    assignWildByColor,
    discardByColor,
    endOptional,
    skipToMandatory,
    passMandatory,
    replenish,
    hasPrivilege,
  };
}
