"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const helpers_1 = require("../helpers");
const fixtures_1 = require("./fixtures");
describe('netCost', () => {
    it('returns full cost when player has no bonuses', () => {
        const card = (0, fixtures_1.makeCard)({ cost: { black: 2, red: 3 } });
        const player = (0, fixtures_1.makePlayer)();
        expect((0, helpers_1.netCost)(card, player)).toEqual({ black: 2, red: 3 });
    });
    it('subtracts matching bonuses from cost', () => {
        const card = (0, fixtures_1.makeCard)({ cost: { black: 2, red: 3 } });
        const purchased = (0, fixtures_1.makeCard)({ id: 2, color: 'black', bonus: 2, cost: {} });
        const player = (0, fixtures_1.makePlayer)({ purchasedCards: [purchased] });
        expect((0, helpers_1.netCost)(card, player)).toEqual({ red: 3 });
    });
    it('floors cost at 0 when bonus exceeds requirement', () => {
        const card = (0, fixtures_1.makeCard)({ cost: { blue: 1 } });
        const purchased = (0, fixtures_1.makeCard)({ id: 2, color: 'blue', bonus: 3, cost: {} });
        const player = (0, fixtures_1.makePlayer)({ purchasedCards: [purchased] });
        expect((0, helpers_1.netCost)(card, player)).toEqual({});
    });
});
describe('canAfford', () => {
    it('returns true when player has exact tokens for cost', () => {
        const card = (0, fixtures_1.makeCard)({ cost: { black: 2 } });
        const player = (0, fixtures_1.makePlayer)({ tokens: { ...(0, helpers_1.emptyPool)(), black: 2 } });
        expect((0, helpers_1.canAfford)(card, player)).toBe(true);
    });
    it('returns false when player has insufficient tokens', () => {
        const card = (0, fixtures_1.makeCard)({ cost: { black: 3 } });
        const player = (0, fixtures_1.makePlayer)({ tokens: { ...(0, helpers_1.emptyPool)(), black: 2 } });
        expect((0, helpers_1.canAfford)(card, player)).toBe(false);
    });
    it('returns true when gold fills the remaining gap', () => {
        const card = (0, fixtures_1.makeCard)({ cost: { black: 3 } });
        const player = (0, fixtures_1.makePlayer)({ tokens: { ...(0, helpers_1.emptyPool)(), black: 2, gold: 1 } });
        expect((0, helpers_1.canAfford)(card, player, { black: 1 })).toBe(true);
    });
    it('returns false when gold allocation exceeds gold held', () => {
        const card = (0, fixtures_1.makeCard)({ cost: { black: 3 } });
        const player = (0, fixtures_1.makePlayer)({ tokens: { ...(0, helpers_1.emptyPool)(), black: 2, gold: 0 } });
        expect((0, helpers_1.canAfford)(card, player, { black: 1 })).toBe(false);
    });
});
describe('checkVictory', () => {
    it('returns prestige when player reaches 20 prestige', () => {
        const player = (0, fixtures_1.makePlayer)({ prestige: 20 });
        expect((0, helpers_1.checkVictory)(player)).toBe('prestige');
    });
    it('returns null below 20 prestige with no other win condition', () => {
        const player = (0, fixtures_1.makePlayer)({ prestige: 19 });
        expect((0, helpers_1.checkVictory)(player)).toBeNull();
    });
    it('returns crowns when player reaches 10 crowns', () => {
        const player = (0, fixtures_1.makePlayer)({ crowns: 10 });
        expect((0, helpers_1.checkVictory)(player)).toBe('crowns');
    });
    it('returns color_prestige when a single color accumulates 10 points', () => {
        const cards = [
            (0, fixtures_1.makeCard)({ id: 1, color: 'red', points: 5 }),
            (0, fixtures_1.makeCard)({ id: 2, color: 'red', points: 5 }),
        ];
        const player = (0, fixtures_1.makePlayer)({ purchasedCards: cards });
        expect((0, helpers_1.checkVictory)(player)).toBe('color_prestige');
    });
    it('counts Wild card points under its assignedColor for color_prestige', () => {
        const redCard = (0, fixtures_1.makeCard)({ id: 1, color: 'red', points: 7 });
        const wildCard = (0, fixtures_1.makeCard)({ id: 2, color: 'wild', points: 3, assignedColor: 'red' });
        const player = (0, fixtures_1.makePlayer)({ purchasedCards: [redCard, wildCard] });
        expect((0, helpers_1.checkVictory)(player)).toBe('color_prestige');
    });
});
describe('totalTokens', () => {
    it('sums all token counts across every color', () => {
        const pool = { ...(0, helpers_1.emptyPool)(), black: 3, gold: 2, pearl: 1 };
        expect((0, helpers_1.totalTokens)(pool)).toBe(6);
    });
});
describe('checkVictory - edge cases', () => {
    it('returns null when player has 19 prestige, 9 crowns, and no color prestige', () => {
        const player = (0, fixtures_1.makePlayer)({ prestige: 19, crowns: 9 });
        expect((0, helpers_1.checkVictory)(player)).toBeNull();
    });
    it('returns null when no single color reaches 10 prestige', () => {
        const cards = [
            (0, fixtures_1.makeCard)({ id: 1, color: 'red', points: 5 }),
            (0, fixtures_1.makeCard)({ id: 2, color: 'blue', points: 9 }),
        ];
        const player = (0, fixtures_1.makePlayer)({ purchasedCards: cards });
        expect((0, helpers_1.checkVictory)(player)).toBeNull();
    });
    it('excludes null-color cards from color prestige check', () => {
        const nullCard = (0, fixtures_1.makeCard)({ id: 1, color: null, points: 10 });
        const player = (0, fixtures_1.makePlayer)({ purchasedCards: [nullCard] });
        expect((0, helpers_1.checkVictory)(player)).toBeNull();
    });
    it('does not double-count a wild card assigned to one color against another', () => {
        const redCard = (0, fixtures_1.makeCard)({ id: 1, color: 'red', points: 5 });
        const wildCard = (0, fixtures_1.makeCard)({ id: 2, color: 'wild', points: 4, assignedColor: 'red' });
        const player = (0, fixtures_1.makePlayer)({ purchasedCards: [redCard, wildCard] });
        // 5+4=9 for red, should not win
        expect((0, helpers_1.checkVictory)(player)).toBeNull();
    });
});
//# sourceMappingURL=helpers.test.js.map