import type { GameState, Action, TokenColor, GemColor, Card, TokenPool } from './types';
import { isValidTokenLine } from './board';
import { netCost, canAfford, GEM_COLORS, MAX_RESERVED, totalTokens, MAX_TOKENS, MAX_TOKENS_IN_LINE, TOKEN_COLORS, CARD_LEVELS } from './helpers';

// ─── Input ────────────────────────────────────────────────────────────────────

/** Remaining undrawn cards per level. */
export interface DeckSizes {
  level1: number;
  level2: number;
  level3: number;
}

/**
 * The information needed to enumerate legal moves.
 *
 * Deck *contents* are deliberately not part of it: whether a player may reserve
 * from the top of a deck depends only on whether that deck is non-empty, never
 * on which card is on top. Accepting either the engine's full `GameState` or a
 * state carrying only `deckCounts` lets a client compute exactly the same move
 * list from its sanitized view that the server computes from the real state —
 * without the server having to reveal the draw order to do it.
 *
 * The PRNG seed is excluded for the same reason: move legality never depends on
 * future random draws.
 */
export type LegalMovesState =
  Omit<GameState, 'decks' | 'rngSeed'> &
  ({ decks: GameState['decks'] } | { deckCounts: DeckSizes });

/** Remaining cards per level, from whichever form the caller supplied. */
function deckSizes(state: LegalMovesState): DeckSizes {
  if ('deckCounts' in state) return state.deckCounts;
  return {
    level1: state.decks.level1.length,
    level2: state.decks.level2.length,
    level3: state.decks.level3.length,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function legalMoves(state: LegalMovesState): Action[] {
  switch (state.phase) {
    case 'optional_privilege':   return optionalPrivilegeMoves(state);
    case 'optional_replenish':   return optionalReplenishMoves(state);
    case 'mandatory':            return mandatoryMoves(state);
    case 'choose_royal':         return chooseRoyalMoves(state);
    case 'resolve_ability':      return resolveAbilityMoves(state);
    case 'assign_wild':          return assignWildColorMoves(state);
    case 'discard':              return discardMoves(state);
    default:                     return [];
  }
}

// ─── Optional: Use Privilege ──────────────────────────────────────────────────

function optionalPrivilegeMoves(state: LegalMovesState): Action[] {
  const moves: Action[] = [{ type: 'END_OPTIONAL_PHASE' }, { type: 'SKIP_TO_MANDATORY' }];
  const player = state.players[state.currentPlayer];
  if (player.privileges === 0) return moves;

  // Collect all non-gold, non-null cell indices available on the board
  const availableIndices = getAvailableBoardIndices(state.board);

  if (availableIndices.length === 0) return moves;

  for (const index of availableIndices) {
    moves.push({ type: 'USE_PRIVILEGE', index });
  }

  return moves;
}

// ─── Optional: Replenish ──────────────────────────────────────────────────────

function optionalReplenishMoves(state: LegalMovesState): Action[] {
  const moves: Action[] = [{ type: 'END_OPTIONAL_PHASE' }, { type: 'SKIP_TO_MANDATORY' }];
  // Can only replenish if bag is non-empty
  if (Object.values(state.bag).some(count => count > 0)) {
    moves.push({ type: 'REPLENISH_BOARD' });
  }
  return moves;
}

// ─── Mandatory ────────────────────────────────────────────────────────────────

function mandatoryMoves(state: LegalMovesState): Action[] {
  const moves: Action[] = [];
  moves.push(...takeTokenMoves(state));
  moves.push(...reserveMoves(state));
  moves.push(...purchaseMoves(state));

  // Special case: if no mandatory moves possible, must replenish first
  if (moves.length === 0 && Object.values(state.bag).some(count => count > 0)) {
    return [{ type: 'REPLENISH_BOARD' }];
  }

  // Last resort: truly no moves — player passes mandatory step (turn ends, discard if needed)
  if (moves.length === 0) {
    return [{ type: 'PASS_MANDATORY' }];
  }

  return moves;
}

// Take up to 3 tokens in a line
function takeTokenMoves(state: LegalMovesState): Action[] {
  const moves: Action[] = [];
  const board = state.board;

  // Find all non-null, non-gold cell indices
  const tokenIndices = getAvailableBoardIndices(board);

  // Generate all valid lines of 1 through MAX_TOKENS_IN_LINE
  const seen = new Set<string>();

  for (let len = 1; len <= MAX_TOKENS_IN_LINE; len++) {
    for (const combo of combinations(tokenIndices, len)) {
      if (isValidTokenLine(combo)) {
        const key = combo.join(',');
        if (!seen.has(key)) {
          seen.add(key);
          moves.push({ type: 'TAKE_TOKENS', indices: combo });
        }
      }
    }
  }

  return moves;
}

// Reserve from pyramid (by card id) or from deck top
function reserveMoves(state: LegalMovesState): Action[] {
  const player = state.players[state.currentPlayer];
  if (player.reservedCards.length >= MAX_RESERVED) return [];

  const board = state.board;
  const hasGold = board.some(token => token === 'gold');
  if (!hasGold) return [];

  const moves: Action[] = [];
  const remaining = deckSizes(state);

  for (const level of CARD_LEVELS) {
    const levelKey = `level${level}` as 'level1' | 'level2' | 'level3';
    for (const card of state.pyramid[levelKey]) {
      moves.push({ type: 'RESERVE_CARD_FROM_PYRAMID', cardId: card.id });
    }
    if (remaining[levelKey] > 0) {
      moves.push({ type: 'RESERVE_CARD_FROM_DECK', source: `deck_${level}` });
    }
  }

  return moves;
}

// Purchase moves — enumerate all affordable cards with valid gold usage.
function purchaseMoves(state: LegalMovesState): Action[] {
  const player = state.players[state.currentPlayer];
  const moves: Action[] = [];

  const candidates: Card[] = [
    ...state.pyramid.level1,
    ...state.pyramid.level2,
    ...state.pyramid.level3,
    ...player.reservedCards,
  ];

  // Wild cards may only be purchased if the player already owns a Jewel Card
  // with an intrinsic gem color (see rulebook: "null is not a color").
  const hasColoredCard = player.purchasedCards.some(ownedCard => ownedCard.color !== null);

  for (const card of candidates) {
    const isWild = card.ability === 'wild' || card.ability === 'wild and turn';
    if (isWild && !hasColoredCard) continue;

    // Build the gold allocation first, then check affordability *with* it.
    //
    // This used to call canAfford(card, player) with no allocation before
    // computing one, which filtered out every card that needed gold — so gold
    // could never be spent on a purchase at all, and goldUsageCombinations below
    // was unreachable for any non-zero shortfall. Gold was effectively reduced
    // to a card-reservation token.
    const cost = netCost(card, player);
    const goldOptions = goldUsageCombinations(cost, player.tokens);
    for (const goldUsage of goldOptions) {
      if (!canAfford(card, player, goldUsage)) continue;
      moves.push({ type: 'PURCHASE_CARD', cardId: card.id, goldUsage });
    }
  }

  return moves;
}

/**
 * Generate the minimal gold usage needed to afford a cost.
 * - If affordable without gold, returns [{}]
 * - If gold needed, returns one option with minimal allocation
 * - Card must be pre-validated by canAfford()
 *
 * Why only the minimal allocation, when the rules permit more
 * -----------------------------------------------------------
 * Spending a gold token in place of a gem the player already holds is legal: a
 * gold is wild and nothing in the rulebook requires paying with the gem first.
 * The reducer accepts any well-formed allocation accordingly (see `canAfford`),
 * so a client that wants to overpay with gold can.
 *
 * `legalMoves` deliberately does not enumerate those allocations. Overpaying
 * with gold is strictly worse than paying with the gem: gold is the scarcest
 * token (3 in the game), it is the only way to reserve a card, and it
 * substitutes for any colour later — so trading it for a gem the player was
 * holding anyway only ever loses flexibility. Enumerating the variants would
 * multiply the move list combinatorially per purchasable card, inflate the AI's
 * branching factor and add a UI choice with no upside.
 *
 * The practical consequence is that `legalMoves` is a list of *reasonable* moves
 * rather than the complete set of legal ones for purchases. That is the one
 * place the two differ, and the fuzz suite's "every action outside legalMoves is
 * inert" property is scoped to exclude gold variants for exactly this reason.
 */
function goldUsageCombinations(
  cost: Partial<Record<TokenColor, number>>,
  playerTokens: TokenPool
): Partial<Record<GemColor | 'pearl', number>>[] {
  let totalShortage = 0;
  const allocation: Partial<Record<GemColor | 'pearl', number>> = {};

  for (const [colorStr, needed] of Object.entries(cost) as [TokenColor, number][]) {
    const have = playerTokens[colorStr] ?? 0;
    const shortage = Math.max(0, needed - have);
    if (shortage > 0) {
      allocation[colorStr as GemColor | 'pearl'] = shortage;
      totalShortage += shortage;
    }
  }

  // If no shortage, no gold needed
  if (totalShortage === 0) {
    return [{}];
  }

  // Return the minimal allocation (card is pre-validated as affordable)
  return [allocation];
}

// ─── Choose Royal Card ────────────────────────────────────────────────────────

function chooseRoyalMoves(state: LegalMovesState): Action[] {
  return state.royalDeck.map(card => ({ type: 'CHOOSE_ROYAL_CARD' as const, cardId: card.id }));
}

// ─── Ability resolution ───────────────────────────────────────────────────────

function resolveAbilityMoves(state: LegalMovesState): Action[] {
  const currentPlayerId = state.currentPlayer;
  const card = state.lastPurchasedCard;
  if (!card) return [];

  if (state.pendingAbility === 'Token') {
    // resolveAbility() only enters resolve_ability when card.color is a gem color
    // and a matching token exists on the board, so the colorless/no-token cases
    // are unreachable here. Enumerate the valid target indices directly.
    const color = card.color as TokenColor;
    const boardIndices = state.board.reduce<number[]>((indices, cell, boardIndex) => { if (cell === color) indices.push(boardIndex); return indices; }, []);
    return boardIndices.map(index => ({ type: 'TAKE_TOKEN_FROM_BOARD', index }));
  }

  if (state.pendingAbility === 'Take') {
    const opponentId = (1 - currentPlayerId) as 0 | 1;
    const oppTokens = state.players[opponentId].tokens;
    const eligible = (GEM_COLORS as TokenColor[]).concat('pearl').filter(
      color => oppTokens[color] > 0,
    );
    return eligible.map(color => ({ type: 'TAKE_TOKEN_FROM_OPPONENT', color }));
  }

  return [];
}

// ─── Assign Wild ─────────────────────────────────────────────────────────────

function assignWildColorMoves(state: LegalMovesState): Action[] {
  const player = state.players[state.currentPlayer];
  const wildCard = state.lastPurchasedCard;
  if (!wildCard) return [];

  const availableColors = new Set<GemColor>(
    player.purchasedCards
      .filter(card => card.id !== wildCard.id && card.color !== null)
      .map(card => card.color as GemColor)
  );

  return Array.from(availableColors).map(color => ({
    type: 'ASSIGN_WILD_COLOR' as const,
    wildCardId: wildCard.id,
    color,
  }));
}

// ─── Discard ──────────────────────────────────────────────────────────────────

function discardMoves(state: LegalMovesState): Action[] {
  const player = state.players[state.currentPlayer];
  const excess = totalTokens(player.tokens) - MAX_TOKENS;
  if (excess <= 0) return [];

  const moves: Action[] = [];
  const pool = player.tokens;

  for (const color of TOKEN_COLORS) {
    if (pool[color] > 0) {
      moves.push({ type: 'DISCARD_TOKENS', color });
    }
  }

  return moves;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function getAvailableBoardIndices(board: LegalMovesState['board']): number[] {
  return board.map((cell, i) => (cell && cell !== 'gold' ? i : -1)).filter(i => i !== -1);
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}
