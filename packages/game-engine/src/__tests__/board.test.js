"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const board_1 = require("../board");
describe('SPIRAL_ORDER', () => {
    it('has 25 unique entries covering all board cells', () => {
        expect(board_1.SPIRAL_ORDER).toHaveLength(25);
        expect(new Set(board_1.SPIRAL_ORDER).size).toBe(25);
        expect(Math.min(...board_1.SPIRAL_ORDER)).toBe(0);
        expect(Math.max(...board_1.SPIRAL_ORDER)).toBe(24);
    });
    it('starts at the center cell (index 12)', () => {
        expect(board_1.SPIRAL_ORDER[0]).toBe(12);
    });
});
describe('isValidTokenLine', () => {
    it('accepts a single cell', () => {
        expect((0, board_1.isValidTokenLine)([7])).toBe(true);
    });
    it('accepts two horizontally adjacent cells', () => {
        expect((0, board_1.isValidTokenLine)([0, 1])).toBe(true);
    });
    it('accepts two vertically adjacent cells', () => {
        expect((0, board_1.isValidTokenLine)([0, 5])).toBe(true);
    });
    it('accepts two diagonally adjacent cells', () => {
        expect((0, board_1.isValidTokenLine)([0, 6])).toBe(true);
    });
    it('accepts three in a horizontal line', () => {
        expect((0, board_1.isValidTokenLine)([0, 1, 2])).toBe(true);
    });
    it('accepts three in a vertical line', () => {
        expect((0, board_1.isValidTokenLine)([0, 5, 10])).toBe(true);
    });
    it('accepts three in a diagonal line', () => {
        expect((0, board_1.isValidTokenLine)([0, 6, 12])).toBe(true);
    });
    it('rejects non-adjacent cells', () => {
        expect((0, board_1.isValidTokenLine)([0, 2])).toBe(false);
    });
    it('rejects an L-shape', () => {
        expect((0, board_1.isValidTokenLine)([0, 1, 6])).toBe(false);
    });
    it('rejects four cells', () => {
        expect((0, board_1.isValidTokenLine)([0, 1, 2, 3])).toBe(false);
    });
    it('rejects an empty array', () => {
        expect((0, board_1.isValidTokenLine)([])).toBe(false);
    });
});
describe('adjacentCells', () => {
    it('returns 8 neighbors for the center cell (12)', () => {
        expect((0, board_1.adjacentCells)(12)).toHaveLength(8);
    });
    it('returns 3 neighbors for a corner cell (0)', () => {
        expect((0, board_1.adjacentCells)(0)).toHaveLength(3);
    });
    it('returns 5 neighbors for a top-edge cell (2)', () => {
        expect((0, board_1.adjacentCells)(2)).toHaveLength(5);
    });
});
//# sourceMappingURL=board.test.js.map