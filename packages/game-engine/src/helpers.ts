import type { TokenPool, TokenColor, GemColor, PlayerState, Card, GameState, PlayerId } from './types';

export const GEM_COLORS: GemColor[] = ['white', 'blue', 'green', 'red', 'black'];
export const TOKEN_COLORS: TokenColor[] = ['white', 'blue', 'green', 'red', 'black', 'pearl', 'gold'];

export const MAX_TOKENS = 10;
export const MAX_RESERVED = 3;
export const MAX_PRIVILEGES = 3;
export const PRESTIGE_WIN = 20;
export const CROWNS_WIN = 10;
export const COLOR_PRESTIGE_WIN = 10;

// ─── Board dimensions ─────────────────────────────────────────────────────────
export const BOARD_WIDTH = 5;
export const BOARD_HEIGHT = 5;
export const BOARD_SIZE = BOARD_WIDTH * BOARD_HEIGHT;

// ─── Pyramid setup ───────────────────────────────────────────────────────────
export const PYRAMID_LEVEL1_COUNT = 5;
export const PYRAMID_LEVEL2_COUNT = 4;
export const PYRAMID_LEVEL3_COUNT = 3;

// ─── Starting tokens ─────────────────────────────────────────────────────────
export const STARTING_GEM_COUNT = 4;
export const STARTING_PEARL_COUNT = 2;
export const STARTING_GOLD_COUNT = 3;

// ─── Gameplay rules ──────────────────────────────────────────────────────────
export const MAX_TOKENS_IN_LINE = 3;
export const CROWN_MILESTONES = [3, 6] as const;
export const CARD_LEVELS = [1, 2, 3] as const;
export const INITIAL_SECOND_PLAYER_PRIVILEGES = 1;
export const INITIAL_TABLE_PRIVILEGES_SECOND = 2;
export const INITIAL_TABLE_PRIVILEGES_FIRST = 3;
export const PENALTY_SAME_COLOR_COUNT = 3;
export const PENALTY_PEARL_COUNT = 2;

// ─── Token pool helpers ───────────────────────────────────────────────────────

export function emptyPool(): TokenPool {
  return { white: 0, blue: 0, green: 0, red: 0, black: 0, pearl: 0, gold: 0 };
}

export function totalTokens(pool: TokenPool): number {
  return TOKEN_COLORS.reduce((total, color) => total + pool[color], 0);
}

// ─── Bonus helpers ────────────────────────────────────────────────────────────

/**
 * Returns the total gem bonuses a player has by color.
 * Wild cards contribute as their assignedColor.
 */
export function playerBonuses(player: PlayerState): Record<GemColor, number> {
  const bonuses: Record<GemColor, number> = { white: 0, blue: 0, green: 0, red: 0, black: 0 };

  for (const card of player.purchasedCards) {
    const color = effectiveCardColor(card);
    if (color) {
      bonuses[color] += card.bonus;
    }
  }

  return bonuses;
}

/**
 * Returns the effective gem color of a card for bonus purposes.
 * Wild cards use assignedColor (null until assigned); null-color cards have no gem color.
 */
export function effectiveCardColor(card: Card): GemColor | null {
  return card.assignedColor ?? card.color;
}

// ─── Cost calculation ─────────────────────────────────────────────────────────

/**
 * Returns the net token cost after applying player bonuses.
 * Result is always >= 0 per color.
 */
export function netCost(card: Card, player: PlayerState): Partial<Record<TokenColor, number>> {
  const bonuses = playerBonuses(player);
  const result: Partial<Record<TokenColor, number>> = {};

  for (const [colorStr, amount] of Object.entries(card.cost) as [TokenColor, number][]) {
    const bonus = GEM_COLORS.includes(colorStr as GemColor) ? (bonuses[colorStr as GemColor] ?? 0) : 0;
    const netAmount = Math.max(0, amount - bonus);
    if (netAmount > 0) result[colorStr] = netAmount;
  }

  return result;
}

/**
 * Returns true if the player can afford the card (with given gold substitutions).
 * goldUsage maps each color to how many gold tokens are used for that color.
 *
 * The goldUsage must be well-formed: for each color in the net cost, the gold
 * assigned to it must be in [0, needed]. Rejecting overallocation (gold > needed)
 * and negative allocations is what prevents the reducer from "minting" tokens
 * when it applies the purchase — you cannot gain tokens by spending gold.
 */
export function canAfford(
  card: Card,
  player: PlayerState,
  goldUsage: Partial<Record<GemColor | 'pearl', number>> = {}
): boolean {
  const cost = netCost(card, player);

  let goldUsed = 0;
  for (const [colorStr, needed] of Object.entries(cost) as [TokenColor, number][]) {
    const have = player.tokens[colorStr] ?? 0;
    const gold = (goldUsage[colorStr as GemColor | 'pearl']) ?? 0;
    // Reject ill-formed gold allocations: negative values, or more gold than this
    // color actually needs (which would refund tokens during deduction).
    if (gold < 0 || gold > needed) return false;
    if (have + gold < needed) return false;
    goldUsed += gold;
  }

  return goldUsed <= player.tokens.gold;
}

// ─── Invariant / conservation helpers ────────────────────────────────────────

/** Returns the total privileges in circulation (table + both players). Should always equal 3. */
export function totalPrivileges(state: GameState): number {
  return state.privileges + state.players[0].privileges + state.players[1].privileges;
}

/**
 * Returns total tokens of each color across all zones: bag + board + both player pools.
 * Each color's count should remain constant throughout the game.
 */
export function totalTokensByColor(state: GameState): TokenPool {
  const totals = emptyPool();
  for (const color of TOKEN_COLORS) {
    totals[color] += state.bag[color];
    totals[color] += state.players[0].tokens[color];
    totals[color] += state.players[1].tokens[color];
  }
  for (const cell of state.board) {
    if (cell) totals[cell] += 1;
  }
  return totals;
}

/**
 * Returns total card counts across all zones: decks + pyramid + both players'
 * purchasedCards + reservedCards. Royal cards tracked separately via royalDeck + royalCards.
 */
export function totalCardCount(state: GameState): { jewel: number; royal: number } {
  const jewel =
    state.decks.level1.length + state.decks.level2.length + state.decks.level3.length +
    state.pyramid.level1.length + state.pyramid.level2.length + state.pyramid.level3.length +
    state.players[0].purchasedCards.length + state.players[0].reservedCards.length +
    state.players[1].purchasedCards.length + state.players[1].reservedCards.length;
  const royal =
    state.royalDeck.length +
    state.players[0].royalCards.length +
    state.players[1].royalCards.length;
  return { jewel, royal };
}

// ─── Privilege helpers ────────────────────────────────────────────────────────

/**
 * Transfer up to `amount` privileges to `to`, taking from table first,
 * then from opponent if table is exhausted.
 * Returns updated [tablePrivileges, players] without mutating.
 */
export function grantPrivileges(
  state: GameState,
  to: PlayerId,
  amount: number
): { privileges: number; players: [PlayerState, PlayerState] } {
  let tablePrivileges = state.privileges;
  const players: [PlayerState, PlayerState] = [
    { ...state.players[0] },
    { ...state.players[1] },
  ];

  for (let grantIndex = 0; grantIndex < amount; grantIndex++) {
    if (players[to].privileges >= MAX_PRIVILEGES) break; // already maxed

    if (tablePrivileges > 0) {
      tablePrivileges--;
      players[to] = { ...players[to], privileges: players[to].privileges + 1 };
    } else {
      const opponentId = (1 - to) as PlayerId;
      if (players[opponentId].privileges > 0) {
        players[opponentId] = { ...players[opponentId], privileges: players[opponentId].privileges - 1 };
        players[to] = { ...players[to], privileges: players[to].privileges + 1 };
      }
      // If neither table nor opponent has privileges, nothing happens
    }
  }

  return { privileges: tablePrivileges, players };
}

// ─── Victory helpers ──────────────────────────────────────────────────────────

export function checkVictory(player: PlayerState): 'prestige' | 'crowns' | 'color_prestige' | null {
  if (player.prestige >= PRESTIGE_WIN) return 'prestige';
  if (player.crowns >= CROWNS_WIN) return 'crowns';

  // Check prestige by color (purchasedCards only — royal cards have no gem color).
  const byColor: Partial<Record<GemColor, number>> = {};
  for (const card of player.purchasedCards) {
    const color = effectiveCardColor(card);
    if (color) {
      byColor[color] = (byColor[color] ?? 0) + card.points;
    }
  }
  for (const points of Object.values(byColor)) {
    if (points >= COLOR_PRESTIGE_WIN) return 'color_prestige';
  }

  return null;
}
