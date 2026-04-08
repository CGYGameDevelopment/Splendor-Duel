import type { GameState, Action, TokenColor, GemColor, Card, TokenPool } from './types';
import { isValidTokenLine } from './board';
import { netCost, canAfford, GEM_COLORS, MAX_RESERVED, totalTokens, MAX_TOKENS, MAX_TOKENS_IN_LINE, TOKEN_COLORS, CARD_LEVELS } from './helpers';

// ─── Public API ───────────────────────────────────────────────────────────────

export function legalMoves(state: GameState): Action[] {
  switch (state.phase) {
    case 'optional_privilege':   return optionalPrivilegeMoves(state);
    case 'optional_replenish':   return optionalReplenishMoves(state);
    case 'mandatory':            return mandatoryMoves(state);
    case 'discard':              return discardMoves(state);
    case 'resolve_ability':      return resolveAbilityMoves(state);
    case 'place_bonus':          return placeBonusMoves(state);
    default:                     return [];
  }
}

// ─── Optional: Use Privilege ──────────────────────────────────────────────────

function optionalPrivilegeMoves(state: GameState): Action[] {
  const moves: Action[] = [{ type: 'END_OPTIONAL_PHASE' }];
  const player = state.players[state.currentPlayer];
  if (player.privileges === 0) return moves;

  // Generate all subsets of board tokens up to maxPrivileges, with repetition
  const tokenCombinationsList = tokenCombinations(state, player.privileges);
  for (const tokens of tokenCombinationsList) {
    moves.push({ type: 'USE_PRIVILEGE', tokens });
  }

  return moves;
}

/** Generate all ways to spend 1..maxPrivileges privileges on available board tokens. */
function tokenCombinations(
  state: GameState,
  maxPrivileges: number
): Partial<Record<TokenColor, number>>[] {
  const results: Partial<Record<TokenColor, number>>[] = [];
  const player = state.players[state.currentPlayer];

  // Count each color available on board
  const boardCounts: Partial<Record<TokenColor, number>> = {};
  for (const cell of state.board) {
    if (cell && cell !== 'gold') {
      boardCounts[cell] = (boardCounts[cell] ?? 0) + 1;
    }
  }

  const colors = Object.keys(boardCounts) as TokenColor[];

  function recurse(
    remainingPrivileges: number,
    currentCombination: Partial<Record<TokenColor, number>>,
    startIndex: number
  ) {
    if (remainingPrivileges === 0) { results.push({ ...currentCombination }); return; }
    // Also allow using fewer than maxPrivileges
    if (Object.keys(currentCombination).length > 0) results.push({ ...currentCombination });

    for (let i = startIndex; i < colors.length; i++) {
      const color = colors[i];
      const used = currentCombination[color] ?? 0;
      const available = boardCounts[color] ?? 0;
      if (used < available) {
        currentCombination[color] = used + 1;
        recurse(remainingPrivileges - 1, currentCombination, i); // allow same color again
        currentCombination[color] = used;
        if (currentCombination[color] === 0) delete currentCombination[color];
      }
    }
  }

  recurse(Math.min(maxPrivileges, player.privileges), {}, 0);
  // Deduplicate (recurse may add duplicates)
  const seen = new Set<string>();
  return results.filter(r => {
    const key = JSON.stringify(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Optional: Replenish ──────────────────────────────────────────────────────

function optionalReplenishMoves(state: GameState): Action[] {
  const moves: Action[] = [{ type: 'END_OPTIONAL_PHASE' }];
  // Can only replenish if bag is non-empty
  if (Object.values(state.bag).some(v => v > 0)) {
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
  if (moves.length === 0 && Object.values(state.bag).some(v => v > 0)) {
    return [{ type: 'REPLENISH_BOARD' }];
  }

  return moves;
}

// Take up to 3 tokens in a line
function takeTokenMoves(state: GameState): Action[] {
  const moves: Action[] = [];
  const board = state.board;

  // Find all non-null, non-gold cell indices
  const tokenIndices = board
    .map((cell, i) => (cell && cell !== 'gold' ? i : -1))
    .filter(i => i !== -1);

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
  const hasGold = board.some(c => c === 'gold');
  if (!hasGold) return [];

  const moves: Action[] = [];

  for (const level of CARD_LEVELS) {
    const key = `level${level}` as 'level1' | 'level2' | 'level3';
    for (const card of state.pyramid[key]) {
      moves.push({ type: 'RESERVE_CARD_FROM_PYRAMID', cardId: card.id });
    }
    if (state.decks[key].length > 0) {
      moves.push({ type: 'RESERVE_CARD', source: `deck_${level}` as 'deck_1' | 'deck_2' | 'deck_3' });
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
    // Bonus cards require an eligible target card
    if (card.ability === 'Bonus' || card.ability === 'Bonus/Turn') {
      const eligible = player.purchasedCards.filter(
        c => c.color !== 'points' && c.bonus > 0 && c.overlappingCardId === null
      );
      if (eligible.length === 0) continue;
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

// ─── Discard ──────────────────────────────────────────────────────────────────

function discardMoves(state: GameState): Action[] {
  const player = state.players[state.currentPlayer];
  const excess = totalTokens(player.tokens) - MAX_TOKENS;
  if (excess <= 0) return [];

  // Generate all ways to discard exactly `excess` tokens
  const moves: Action[] = [];
  const pool = player.tokens;

  function recurse(
    remaining: number,
    current: Partial<Record<TokenColor, number>>,
    colorIdx: number
  ) {
    if (remaining === 0) { moves.push({ type: 'DISCARD_TOKENS', tokens: { ...current } }); return; }
    if (colorIdx >= TOKEN_COLORS.length) return;

    const color = TOKEN_COLORS[colorIdx];
    const have = pool[color];

    for (let discard = 0; discard <= Math.min(have, remaining); discard++) {
      if (discard > 0) current[color] = discard;
      recurse(remaining - discard, current, colorIdx + 1);
      delete current[color];
    }
  }

  recurse(excess, {}, 0);
  return moves;
}

// ─── Ability resolution ───────────────────────────────────────────────────────

function resolveAbilityMoves(state: GameState): Action[] {
  const cp = state.currentPlayer;
  const player = state.players[cp];
  const card = state.lastPurchasedCard;
  if (!card) return [];

  if (state.pendingAbility === 'Token') {
    const color = card.color as TokenColor;
    const onBoard = state.board.some(c => c === color);
    if (!onBoard) return [{ type: 'END_OPTIONAL_PHASE' }]; // auto-skipped in reducer, but guard
    return [{ type: 'TAKE_TOKEN_FROM_BOARD', color }];
  }

  if (state.pendingAbility === 'Take') {
    const opp = (1 - cp) as 0 | 1;
    const oppTokens = state.players[opp].tokens;
    const eligible = (GEM_COLORS as TokenColor[]).concat('pearl').filter(
      c => oppTokens[c as TokenColor] > 0
    ) as TokenColor[];
    return eligible.map(color => ({ type: 'TAKE_TOKEN_FROM_OPPONENT', color }));
  }

  return [];
}

// ─── Place Bonus ──────────────────────────────────────────────────────────────

function placeBonusMoves(state: GameState): Action[] {
  const player = state.players[state.currentPlayer];
  const bonusCard = state.lastPurchasedCard;
  if (!bonusCard) return [];

  const eligible = player.purchasedCards.filter(
    c => c.id !== bonusCard.id && c.color !== 'points' && c.bonus > 0 && c.overlappingCardId === null
  );

  return eligible.map(target => ({
    type: 'PLACE_BONUS_CARD' as const,
    bonusCardId: bonusCard.id,
    targetCardId: target.id,
  }));
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}
