"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeCard = makeCard;
exports.makePlayer = makePlayer;
const helpers_1 = require("../helpers");
function makeCard(overrides = {}) {
    return {
        id: 99, level: 1, color: 'black', points: 0, bonus: 1,
        ability: null, crowns: 0, cost: {}, assignedColor: null,
        ...overrides,
    };
}
function makePlayer(overrides = {}) {
    return {
        tokens: (0, helpers_1.emptyPool)(),
        purchasedCards: [],
        reservedCards: [],
        privileges: 0,
        crowns: 0,
        prestige: 0,
        royalCards: [],
        ...overrides,
    };
}
//# sourceMappingURL=fixtures.js.map