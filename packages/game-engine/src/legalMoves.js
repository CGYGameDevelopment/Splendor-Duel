"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.legalMoves = legalMoves;
const board_1 = require("./board");
const helpers_1 = require("./helpers");
// ─── Public API ───────────────────────────────────────────────────────────────
function legalMoves(state) {
    switch (state.phase) {
        case 'optional_privilege': return optionalPrivilegeMoves(state);
        case 'optional_replenish': return optionalReplenishMoves(state);
        case 'mandatory': return mandatoryMoves(state);
        case 'choose_royal': return chooseRoyalMoves(state);
        case 'resolve_ability': return resolveAbilityMoves(state);
        case 'assign_wild': return placeBonusMoves(state);
        case 'discard': return discardMoves(state);
        default: return [];
    }
}
// ─── Optional: Use Privilege ──────────────────────────────────────────────────
function optionalPrivilegeMoves(state) {
    const moves = [{ type: 'END_OPTIONAL_PHASE' }, { type: 'SKIP_TO_MANDATORY' }];
    const player = state.players[state.currentPlayer];
    if (player.privileges === 0)
        return moves;
    // Collect all non-gold, non-null cell indices available on the board
    const availableIndices = getAvailableBoardIndices(state.board);
    if (availableIndices.length === 0)
        return moves;
    // Generate all combinations of 1..maxPrivileges distinct cell indices
    const maxPrivileges = Math.min(player.privileges, availableIndices.length);
    for (let len = 1; len <= maxPrivileges; len++) {
        for (const combo of combinations(availableIndices, len)) {
            moves.push({ type: 'USE_PRIVILEGE', indices: combo });
        }
    }
    return moves;
}
// ─── Optional: Replenish ──────────────────────────────────────────────────────
function optionalReplenishMoves(state) {
    const moves = [{ type: 'END_OPTIONAL_PHASE' }, { type: 'SKIP_TO_MANDATORY' }];
    // Can only replenish if bag is non-empty
    if (Object.values(state.bag).some(v => v > 0)) {
        moves.push({ type: 'REPLENISH_BOARD' });
    }
    return moves;
}
// ─── Mandatory ────────────────────────────────────────────────────────────────
function mandatoryMoves(state) {
    const moves = [];
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
function takeTokenMoves(state) {
    const moves = [];
    const board = state.board;
    // Find all non-null, non-gold cell indices
    const tokenIndices = getAvailableBoardIndices(board);
    // Generate all valid lines of 1 through MAX_TOKENS_IN_LINE
    const seen = new Set();
    for (let len = 1; len <= helpers_1.MAX_TOKENS_IN_LINE; len++) {
        for (const combo of combinations(tokenIndices, len)) {
            if ((0, board_1.isValidTokenLine)(combo)) {
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
function reserveMoves(state) {
    const player = state.players[state.currentPlayer];
    if (player.reservedCards.length >= helpers_1.MAX_RESERVED)
        return [];
    const board = state.board;
    const hasGold = board.some(c => c === 'gold');
    if (!hasGold)
        return [];
    const moves = [];
    for (const level of helpers_1.CARD_LEVELS) {
        const key = `level${level}`;
        for (const card of state.pyramid[key]) {
            moves.push({ type: 'RESERVE_CARD_FROM_PYRAMID', cardId: card.id });
        }
        if (state.decks[key].length > 0) {
            moves.push({ type: 'RESERVE_CARD', source: `deck_${level}` });
        }
    }
    return moves;
}
// Purchase moves — enumerate all affordable cards with valid gold usage
function purchaseMoves(state) {
    const player = state.players[state.currentPlayer];
    const moves = [];
    const candidates = [
        ...state.pyramid.level1,
        ...state.pyramid.level2,
        ...state.pyramid.level3,
        ...player.reservedCards,
    ];
    for (const card of candidates) {
        // Wild cards require the player to own at least one Jewel Card with a GemColor
        if (card.color === 'wild') {
            const hasColoredCard = player.purchasedCards.some(c => c.color !== 'wild' && c.color !== null);
            if (!hasColoredCard)
                continue;
            if (!(0, helpers_1.canAfford)(card, player))
                continue;
            const cost = (0, helpers_1.netCost)(card, player);
            const goldOptions = goldUsageCombinations(cost, player.tokens);
            for (const goldUsage of goldOptions) {
                moves.push({ type: 'PURCHASE_CARD', cardId: card.id, goldUsage });
            }
            continue;
        }
        const cost = (0, helpers_1.netCost)(card, player);
        if ((0, helpers_1.canAfford)(card, player)) {
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
function goldUsageCombinations(cost, playerTokens) {
    let totalShortage = 0;
    const allocation = {};
    for (const [colorStr, needed] of Object.entries(cost)) {
        const have = playerTokens[colorStr] ?? 0;
        const shortage = Math.max(0, needed - have);
        if (shortage > 0) {
            allocation[colorStr] = shortage;
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
function chooseRoyalMoves(state) {
    return state.royalDeck.map(card => ({ type: 'CHOOSE_ROYAL_CARD', cardId: card.id }));
}
// ─── Ability resolution ───────────────────────────────────────────────────────
function resolveAbilityMoves(state) {
    const cp = state.currentPlayer;
    const player = state.players[cp];
    const card = state.lastPurchasedCard;
    if (!card)
        return [];
    if (state.pendingAbility === 'Token') {
        // resolveAbility() only enters resolve_ability when card.color is a gem color
        // and a matching token exists on the board, so the colorless/no-token cases
        // are unreachable here. Enumerate the valid target indices directly.
        const color = card.color;
        const indices = state.board.reduce((acc, c, i) => { if (c === color)
            acc.push(i); return acc; }, []);
        return indices.map(index => ({ type: 'TAKE_TOKEN_FROM_BOARD', index }));
    }
    if (state.pendingAbility === 'Take') {
        const opp = (1 - cp);
        const oppTokens = state.players[opp].tokens;
        const eligible = helpers_1.GEM_COLORS.concat('pearl').filter(c => oppTokens[c] > 0);
        return eligible.map(color => ({ type: 'TAKE_TOKEN_FROM_OPPONENT', color }));
    }
    return [];
}
// ─── Assign Wild ─────────────────────────────────────────────────────────────
function placeBonusMoves(state) {
    const player = state.players[state.currentPlayer];
    const wildCard = state.lastPurchasedCard;
    if (!wildCard)
        return [];
    const availableColors = new Set(player.purchasedCards
        .filter(c => c.id !== wildCard.id && c.color !== 'wild' && c.color !== null)
        .map(c => c.color));
    return Array.from(availableColors).map(color => ({
        type: 'ASSIGN_WILD_COLOR',
        wildCardId: wildCard.id,
        color,
    }));
}
// ─── Discard ──────────────────────────────────────────────────────────────────
function discardMoves(state) {
    const player = state.players[state.currentPlayer];
    const excess = (0, helpers_1.totalTokens)(player.tokens) - helpers_1.MAX_TOKENS;
    if (excess <= 0)
        return [];
    // Generate all ways to discard exactly `excess` tokens
    const moves = [];
    const pool = player.tokens;
    function recurse(remaining, current, colorIdx) {
        if (remaining === 0) {
            moves.push({ type: 'DISCARD_TOKENS', tokens: { ...current } });
            return;
        }
        if (colorIdx >= helpers_1.TOKEN_COLORS.length)
            return;
        const color = helpers_1.TOKEN_COLORS[colorIdx];
        const have = pool[color];
        for (let discard = 0; discard <= Math.min(have, remaining); discard++) {
            if (discard > 0)
                current[color] = discard;
            recurse(remaining - discard, current, colorIdx + 1);
            delete current[color];
        }
    }
    recurse(excess, {}, 0);
    return moves;
}
// ─── Utility ──────────────────────────────────────────────────────────────────
function getAvailableBoardIndices(board) {
    return board.map((cell, i) => (cell && cell !== 'gold' ? i : -1)).filter(i => i !== -1);
}
function combinations(arr, k) {
    if (k === 0)
        return [[]];
    if (arr.length === 0)
        return [];
    const [first, ...rest] = arr;
    const withFirst = combinations(rest, k - 1).map(c => [first, ...c]);
    const withoutFirst = combinations(rest, k);
    return [...withFirst, ...withoutFirst];
}
//# sourceMappingURL=legalMoves.js.map