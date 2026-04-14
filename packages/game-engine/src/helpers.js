"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PENALTY_PEARL_COUNT = exports.PENALTY_SAME_COLOR_COUNT = exports.INITIAL_TABLE_PRIVILEGES_FIRST = exports.INITIAL_TABLE_PRIVILEGES_SECOND = exports.INITIAL_SECOND_PLAYER_PRIVILEGES = exports.CARD_LEVELS = exports.CROWN_MILESTONES = exports.MAX_TOKENS_IN_LINE = exports.STARTING_GOLD_COUNT = exports.STARTING_PEARL_COUNT = exports.STARTING_GEM_COUNT = exports.PYRAMID_LEVEL3_COUNT = exports.PYRAMID_LEVEL2_COUNT = exports.PYRAMID_LEVEL1_COUNT = exports.BOARD_SIZE = exports.BOARD_HEIGHT = exports.BOARD_WIDTH = exports.COLOR_PRESTIGE_WIN = exports.CROWNS_WIN = exports.PRESTIGE_WIN = exports.MAX_PRIVILEGES = exports.MAX_RESERVED = exports.MAX_TOKENS = exports.TOKEN_COLORS = exports.GEM_COLORS = void 0;
exports.emptyPool = emptyPool;
exports.totalTokens = totalTokens;
exports.playerBonuses = playerBonuses;
exports.effectiveCardColor = effectiveCardColor;
exports.netCost = netCost;
exports.canAfford = canAfford;
exports.totalPrivileges = totalPrivileges;
exports.totalTokensByColor = totalTokensByColor;
exports.totalCardCount = totalCardCount;
exports.grantPrivileges = grantPrivileges;
exports.checkVictory = checkVictory;
exports.GEM_COLORS = ['white', 'blue', 'green', 'red', 'black'];
exports.TOKEN_COLORS = ['white', 'blue', 'green', 'red', 'black', 'pearl', 'gold'];
exports.MAX_TOKENS = 10;
exports.MAX_RESERVED = 3;
exports.MAX_PRIVILEGES = 3;
exports.PRESTIGE_WIN = 20;
exports.CROWNS_WIN = 10;
exports.COLOR_PRESTIGE_WIN = 10;
// ─── Board dimensions ─────────────────────────────────────────────────────────
exports.BOARD_WIDTH = 5;
exports.BOARD_HEIGHT = 5;
exports.BOARD_SIZE = exports.BOARD_WIDTH * exports.BOARD_HEIGHT;
// ─── Pyramid setup ───────────────────────────────────────────────────────────
exports.PYRAMID_LEVEL1_COUNT = 5;
exports.PYRAMID_LEVEL2_COUNT = 4;
exports.PYRAMID_LEVEL3_COUNT = 3;
// ─── Starting tokens ─────────────────────────────────────────────────────────
exports.STARTING_GEM_COUNT = 4;
exports.STARTING_PEARL_COUNT = 2;
exports.STARTING_GOLD_COUNT = 3;
// ─── Gameplay rules ──────────────────────────────────────────────────────────
exports.MAX_TOKENS_IN_LINE = 3;
exports.CROWN_MILESTONES = [3, 6];
exports.CARD_LEVELS = [1, 2, 3];
exports.INITIAL_SECOND_PLAYER_PRIVILEGES = 1;
exports.INITIAL_TABLE_PRIVILEGES_SECOND = 2;
exports.INITIAL_TABLE_PRIVILEGES_FIRST = 3;
exports.PENALTY_SAME_COLOR_COUNT = 3;
exports.PENALTY_PEARL_COUNT = 2;
// ─── Token pool helpers ───────────────────────────────────────────────────────
function emptyPool() {
    return { white: 0, blue: 0, green: 0, red: 0, black: 0, pearl: 0, gold: 0 };
}
function totalTokens(pool) {
    return exports.TOKEN_COLORS.reduce((sum, c) => sum + pool[c], 0);
}
// ─── Bonus helpers ────────────────────────────────────────────────────────────
/**
 * Returns the total gem bonuses a player has by color.
 * Wild cards contribute as their assignedColor.
 */
function playerBonuses(player) {
    const bonuses = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
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
 * Wild cards use assignedColor; null-color cards have no gem color.
 */
function effectiveCardColor(card) {
    if (card.color === 'wild')
        return card.assignedColor;
    if (card.color === null)
        return null;
    return card.color;
}
// ─── Cost calculation ─────────────────────────────────────────────────────────
/**
 * Returns the net token cost after applying player bonuses.
 * Result is always >= 0 per color.
 */
function netCost(card, player) {
    const bonuses = playerBonuses(player);
    const result = {};
    for (const [colorStr, amount] of Object.entries(card.cost)) {
        const bonus = exports.GEM_COLORS.includes(colorStr) ? (bonuses[colorStr] ?? 0) : 0;
        const net = Math.max(0, amount - bonus);
        if (net > 0)
            result[colorStr] = net;
    }
    return result;
}
/**
 * Returns true if the player can afford the card (with given gold substitutions).
 * goldUsage maps each color to how many gold tokens are used for that color.
 */
function canAfford(card, player, goldUsage = {}) {
    const cost = netCost(card, player);
    let goldUsed = 0;
    for (const [colorStr, needed] of Object.entries(cost)) {
        const have = player.tokens[colorStr] ?? 0;
        const gold = (goldUsage[colorStr]) ?? 0;
        if (have + gold < needed)
            return false;
        goldUsed += gold;
    }
    return goldUsed <= player.tokens.gold;
}
// ─── Invariant / conservation helpers ────────────────────────────────────────
/** Returns the total privileges in circulation (table + both players). Should always equal 3. */
function totalPrivileges(state) {
    return state.privileges + state.players[0].privileges + state.players[1].privileges;
}
/**
 * Returns total tokens of each color across all zones: bag + board + both player pools.
 * Each color's count should remain constant throughout the game.
 */
function totalTokensByColor(state) {
    const totals = emptyPool();
    for (const color of exports.TOKEN_COLORS) {
        totals[color] += state.bag[color];
        totals[color] += state.players[0].tokens[color];
        totals[color] += state.players[1].tokens[color];
    }
    for (const cell of state.board) {
        if (cell)
            totals[cell] += 1;
    }
    return totals;
}
/**
 * Returns total card counts across all zones: decks + pyramid + both players'
 * purchasedCards + reservedCards. Royal cards tracked separately via royalDeck + royalCards.
 */
function totalCardCount(state) {
    const jewel = state.decks.level1.length + state.decks.level2.length + state.decks.level3.length +
        state.pyramid.level1.length + state.pyramid.level2.length + state.pyramid.level3.length +
        state.players[0].purchasedCards.length + state.players[0].reservedCards.length +
        state.players[1].purchasedCards.length + state.players[1].reservedCards.length;
    const royal = state.royalDeck.length +
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
function grantPrivileges(state, to, amount) {
    let tablePrivileges = state.privileges;
    const players = [
        { ...state.players[0] },
        { ...state.players[1] },
    ];
    for (let i = 0; i < amount; i++) {
        if (players[to].privileges >= exports.MAX_PRIVILEGES)
            break; // already maxed
        if (tablePrivileges > 0) {
            tablePrivileges--;
            players[to] = { ...players[to], privileges: players[to].privileges + 1 };
        }
        else {
            const opp = (1 - to);
            if (players[opp].privileges > 0) {
                players[opp] = { ...players[opp], privileges: players[opp].privileges - 1 };
                players[to] = { ...players[to], privileges: players[to].privileges + 1 };
            }
            // If neither table nor opponent has privileges, nothing happens
        }
    }
    return { privileges: tablePrivileges, players };
}
// ─── Victory helpers ──────────────────────────────────────────────────────────
function checkVictory(player) {
    if (player.prestige >= exports.PRESTIGE_WIN)
        return 'prestige';
    if (player.crowns >= exports.CROWNS_WIN)
        return 'crowns';
    // Check prestige by color (purchasedCards only — royal cards have no gem color).
    const byColor = {};
    for (const card of player.purchasedCards) {
        const color = effectiveCardColor(card);
        if (color) {
            byColor[color] = (byColor[color] ?? 0) + card.points;
        }
    }
    for (const points of Object.values(byColor)) {
        if (points >= exports.COLOR_PRESTIGE_WIN)
            return 'color_prestige';
    }
    return null;
}
//# sourceMappingURL=helpers.js.map