import type { TokenPool, TokenColor, GemColor, PlayerState, Card, GameState, PlayerId } from './types';
export declare const GEM_COLORS: GemColor[];
export declare const TOKEN_COLORS: TokenColor[];
export declare const MAX_TOKENS = 10;
export declare const MAX_RESERVED = 3;
export declare const MAX_PRIVILEGES = 3;
export declare const PRESTIGE_WIN = 20;
export declare const CROWNS_WIN = 10;
export declare const COLOR_PRESTIGE_WIN = 10;
export declare const BOARD_WIDTH = 5;
export declare const BOARD_HEIGHT = 5;
export declare const BOARD_SIZE: number;
export declare const PYRAMID_LEVEL1_COUNT = 5;
export declare const PYRAMID_LEVEL2_COUNT = 4;
export declare const PYRAMID_LEVEL3_COUNT = 3;
export declare const STARTING_GEM_COUNT = 4;
export declare const STARTING_PEARL_COUNT = 2;
export declare const STARTING_GOLD_COUNT = 3;
export declare const MAX_TOKENS_IN_LINE = 3;
export declare const CROWN_MILESTONES: readonly [3, 6];
export declare const CARD_LEVELS: readonly [1, 2, 3];
export declare const INITIAL_SECOND_PLAYER_PRIVILEGES = 1;
export declare const INITIAL_TABLE_PRIVILEGES_SECOND = 2;
export declare const INITIAL_TABLE_PRIVILEGES_FIRST = 3;
export declare const PENALTY_SAME_COLOR_COUNT = 3;
export declare const PENALTY_PEARL_COUNT = 2;
export declare function emptyPool(): TokenPool;
export declare function totalTokens(pool: TokenPool): number;
/**
 * Returns the total gem bonuses a player has by color.
 * Wild cards contribute as their assignedColor.
 */
export declare function playerBonuses(player: PlayerState): Record<GemColor, number>;
/**
 * Returns the effective gem color of a card for bonus purposes.
 * Wild cards use assignedColor; null-color cards have no gem color.
 */
export declare function effectiveCardColor(card: Card): GemColor | null;
/**
 * Returns the net token cost after applying player bonuses.
 * Result is always >= 0 per color.
 */
export declare function netCost(card: Card, player: PlayerState): Partial<Record<TokenColor, number>>;
/**
 * Returns true if the player can afford the card (with given gold substitutions).
 * goldUsage maps each color to how many gold tokens are used for that color.
 */
export declare function canAfford(card: Card, player: PlayerState, goldUsage?: Partial<Record<GemColor | 'pearl', number>>): boolean;
/** Returns the total privileges in circulation (table + both players). Should always equal 3. */
export declare function totalPrivileges(state: GameState): number;
/**
 * Returns total tokens of each color across all zones: bag + board + both player pools.
 * Each color's count should remain constant throughout the game.
 */
export declare function totalTokensByColor(state: GameState): TokenPool;
/**
 * Returns total card counts across all zones: decks + pyramid + both players'
 * purchasedCards + reservedCards. Royal cards tracked separately via royalDeck + royalCards.
 */
export declare function totalCardCount(state: GameState): {
    jewel: number;
    royal: number;
};
/**
 * Transfer up to `amount` privileges to `to`, taking from table first,
 * then from opponent if table is exhausted.
 * Returns updated [tablePrivileges, players] without mutating.
 */
export declare function grantPrivileges(state: GameState, to: PlayerId, amount: number): {
    privileges: number;
    players: [PlayerState, PlayerState];
};
export declare function checkVictory(player: PlayerState): 'prestige' | 'crowns' | 'color_prestige' | null;
//# sourceMappingURL=helpers.d.ts.map