"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInitialState = createInitialState;
const board_1 = require("./board");
const helpers_1 = require("./helpers");
const jewel_cards_json_1 = __importDefault(require("./data/jewel-cards.json"));
const royal_cards_json_1 = __importDefault(require("./data/royal-cards.json"));
const ALL_CARDS = jewel_cards_json_1.default;
const ALL_ROYAL_CARDS = royal_cards_json_1.default;
function makePlayer() {
    return {
        tokens: (0, helpers_1.emptyPool)(),
        purchasedCards: [],
        reservedCards: [],
        privileges: 0,
        crowns: 0,
        prestige: 0,
        royalCards: [],
    };
}
function shuffle(arr) {
    const array = [...arr];
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
/** Returns a fresh game state ready to play. secondPlayerGetsPrivilege = true by default. */
function createInitialState(secondPlayerGetsPrivilege = true) {
    const level1 = shuffle(ALL_CARDS.filter(card => card.level === 1));
    const level2 = shuffle(ALL_CARDS.filter(card => card.level === 2));
    const level3 = shuffle(ALL_CARDS.filter(card => card.level === 3));
    const royalDeck = shuffle(ALL_ROYAL_CARDS);
    // Reveal pyramid: PYRAMID_LEVEL1_COUNT, PYRAMID_LEVEL2_COUNT, PYRAMID_LEVEL3_COUNT
    const pyramid = {
        level1: level1.slice(0, helpers_1.PYRAMID_LEVEL1_COUNT),
        level2: level2.slice(0, helpers_1.PYRAMID_LEVEL2_COUNT),
        level3: level3.slice(0, helpers_1.PYRAMID_LEVEL3_COUNT),
    };
    const decks = {
        level1: level1.slice(helpers_1.PYRAMID_LEVEL1_COUNT),
        level2: level2.slice(helpers_1.PYRAMID_LEVEL2_COUNT),
        level3: level3.slice(helpers_1.PYRAMID_LEVEL3_COUNT),
    };
    // Build and place tokens on board in spiral order
    const startingTokens = {
        black: helpers_1.STARTING_GEM_COUNT,
        red: helpers_1.STARTING_GEM_COUNT,
        green: helpers_1.STARTING_GEM_COUNT,
        blue: helpers_1.STARTING_GEM_COUNT,
        white: helpers_1.STARTING_GEM_COUNT,
        pearl: helpers_1.STARTING_PEARL_COUNT,
        gold: helpers_1.STARTING_GOLD_COUNT,
    };
    // Flatten tokens into a shuffled bag, then place on spiral
    const tokenList = [];
    for (const [color, count] of Object.entries(startingTokens)) {
        for (let i = 0; i < count; i++)
            tokenList.push(color);
    }
    const shuffledTokens = shuffle(tokenList);
    const board = new Array(helpers_1.BOARD_SIZE).fill(null);
    for (let i = 0; i < Math.min(shuffledTokens.length, helpers_1.BOARD_SIZE); i++) {
        board[board_1.SPIRAL_ORDER[i]] = shuffledTokens[i];
    }
    const bag = (0, helpers_1.emptyPool)(); // all tokens start on board
    const players = [makePlayer(), makePlayer()];
    // Second player (index 1) gets 1 privilege to compensate for going second
    if (secondPlayerGetsPrivilege) {
        players[1] = { ...players[1], privileges: helpers_1.INITIAL_SECOND_PLAYER_PRIVILEGES };
    }
    const tablePrivileges = secondPlayerGetsPrivilege ? helpers_1.INITIAL_TABLE_PRIVILEGES_SECOND : helpers_1.INITIAL_TABLE_PRIVILEGES_FIRST;
    return {
        board,
        bag,
        pyramid,
        decks,
        royalDeck,
        privileges: tablePrivileges,
        players,
        currentPlayer: 0,
        phase: 'optional_privilege',
        repeatTurn: false,
        pendingCrownCheck: false,
        pendingAbility: null,
        lastPurchasedCard: null,
        winner: null,
        winCondition: null,
    };
}
//# sourceMappingURL=initialState.js.map