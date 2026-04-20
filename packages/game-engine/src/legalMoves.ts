import type { GameState, Action, TokenColor, GemColor, Card, TokenPool } from './types';
import { isValidTokenLine } from './board';
import { netCost, canAfford, GEM_COLORS, MAX_RESERVED, totalTokens, MAX_TOKENS, MAX_TOKENS_IN_LINE, TOKEN_COLORS, CARD_LEVELS } from './helpers';

// ─── Public API ───────────────────────────────────────────────────────────────

export function legalMoves(state: GameState): Action[] {
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

function optionalPrivilegeMoves(state: GameState): Action[] {
  const moves: Action[] = [{ type: 'END_OPTIONAL_PHASE' }, { type: 'SKIP_TO_MANDATORY' }];
  const player = state.players[state.currentPlayer];
  if (player.privileges === 0) return moves;

  // Collect all non-gold, non-null cell indices available on the board
  const availableIndices = getAvailableBoardIndices(state.board);

  if (availableIndices.length === 0) return moves;

  for (const index of availableIndices) {
    moves.push({ type: 'USE_PRIVILEGE', indices: [index] });
  }

  return moves;
}

// ─── Optional: Replenish ──────────────────────────────────────────────────────

function optionalReplenishMoves(state: GameState): Action[] {
  const moves: Action[] = [{ type: 'END_OPTIONAL_PHASE' }, { type: 'SKIP_TO_MANDATORY' }];
  // Can only replenish if bag is non-empty
  if (Object.values(state.bag).some(count => count > 0)) {
    moves.push({ type: 'REPLENISH_BOARD' });
  }
  return moves;
}

// ─── Mandatory ────────────────────────────────────────────────────────────────

function mandatoryMoves(state: GameState): Action[] {
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
function takeTokenMoves(state: GameState): Action[] {
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
function reserveMoves(state: GameState): Action[] {
  const player = state.players[state.currentPlayer];
  if (player.reservedCards.length >= MAX_RESERVED) return [];

  const board = state.board;
  const hasGold = board.some(token => token === 'gold');
  if (!hasGold) return [];

  const moves: Action[] = [];

  for (const level of CARD_LEVELS) {
    const levelKey = `level${level}` as 'level1' | 'level2' | 'level3';
    for (const card of state.pyramid[levelKey]) {
      moves.push({ type: 'RESERVE_CARD_FROM_PYRAMID', cardId: card.id });
    }
    if (state.decks[levelKey].length > 0) {
      moves.push({ type: 'RESERVE_CARD_FROM_DECK', source: `deck_${level}` as 'deck_1' | 'deck_2' | 'deck_3' });
    }
  }

  return moves;
}

// Purchase moves — enumerate all affordable cards with valid gold usage
function purchaseMoves(state: GameState): Action[] {
  const player = state.players[state.currentPlayer];
  const moves: Action[] = [];

  const candidates: Card[] = [
    ...state.pyramid.level1,
    ...state.pyramid.level2,
    ...state.pyramid.level3,
    ...player.reservedCards,
  ];

  for (const card of candidates) {
    // Wild cards require the player to own at least one Jewel Card with a GemColor
    if (card.color === 'wild') {
      const hasColoredCard = player.purchasedCards.some(
        ownedCard => ownedCard.color !== 'wild' && ownedCard.color !== null
      );
      if (!hasColoredCard) continue;
      if (!canAfford(card, player)) continue;
      const cost = netCost(card, player);
      const goldOptions = goldUsageCombinations(cost, player.tokens);
      for (const goldUsage of goldOptions) {
        moves.push({ type: 'PURCHASE_CARD', cardId: card.id, goldUsage });
      }
      continue;
    }

    const cost = netCost(card, player);

    if (canAfford(card, player)) {
      // Generate gold usage options
      const goldOptions = goldUsageCombinations(cost, player.tokens);
      for (const goldUsage of goldOptions) {
        moves.push({ type: 'PURCHASE_CARD', cardId: card.id, goldUsage });
      }
    }
  }

  return moves;
}

/**
 * Generate the minimal gold usage needed to afford a cost.
 * - If affordable without gold, returns [{}]
 * - If gold needed, returns one option with minimal allocation
 * - Card must be pre-validated by canAfford()
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

function chooseRoyalMoves(state: GameState): Action[] {
  return state.royalDeck.map(card => ({ type: 'CHOOSE_ROYAL_CARD' as const, cardId: card.id }));
}

// ─── Ability resolution ───────────────────────────────────────────────────────

function resolveAbilityMoves(state: GameState): Action[] {
  const currentPlayerId = state.currentPlayer;
  const player = state.players[currentPlayerId];
  const card = state.lastPurchasedCard;
  if (!card) return [];

  if (state.pendingAbility === 'Token') {
    // resolveAbility() only enters resolve_ability when card.color is a gem color
    // and a matching token exists on the board, so the colorless/no-token cases
    // are unreachable here. Enumerate the valid target indices directly.
    const color = card.color as TokenColor;
    const boardIndices = state.board.reduce<number[]>((indices, cell, boardIndex) => { if (cell === color) indices.push(boardIndex); return indices; }, []);
    return boardIndices.map(index => ({ type: 'TAKE_TOKEN_FROM_BOARD', index }) as Action);
  }

  if (state.pendingAbility === 'Take') {
    const opponentId = (1 - currentPlayerId) as 0 | 1;
    const oppTokens = state.players[opponentId].tokens;
    const eligible = (GEM_COLORS as TokenColor[]).concat('pearl').filter(
      color => oppTokens[color as TokenColor] > 0
    ) as TokenColor[];
    return eligible.map(color => ({ type: 'TAKE_TOKEN_FROM_OPPONENT', color }));
  }

  return [];
}

// ─── Assign Wild ─────────────────────────────────────────────────────────────

function assignWildColorMoves(state: GameState): Action[] {
  const player = state.players[state.currentPlayer];
  const wildCard = state.lastPurchasedCard;
  if (!wildCard) return [];

  const availableColors = new Set<GemColor>(
    player.purchasedCards
      .filter(card => card.id !== wildCard.id && card.color !== 'wild' && card.color !== null)
      .map(card => card.color as GemColor)
  );

  return Array.from(availableColors).map(color => ({
    type: 'ASSIGN_WILD_COLOR' as const,
    wildCardId: wildCard.id,
    color,
  }));
}

// ─── Discard ──────────────────────────────────────────────────────────────────

function discardMoves(state: GameState): Action[] {
  const player = state.players[state.currentPlayer];
  const excess = totalTokens(player.tokens) - MAX_TOKENS;
  if (excess <= 0) return [];

  const moves: Action[] = [];
  const pool = player.tokens;

  for (const color of TOKEN_COLORS) {
    if (pool[color] > 0) {
      moves.push({ type: 'DISCARD_TOKENS', tokens: { [color]: 1 } });
    }
  }

  return moves;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function getAvailableBoardIndices(board: GameState['board']): number[] {
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
