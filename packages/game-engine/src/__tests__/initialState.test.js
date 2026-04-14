"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const initialState_1 = require("../initialState");
const helpers_1 = require("../helpers");
const TOTAL_TOKENS = helpers_1.STARTING_GEM_COUNT * 5 + helpers_1.STARTING_PEARL_COUNT + helpers_1.STARTING_GOLD_COUNT;
describe('createInitialState', () => {
    it('places exactly the correct total number of tokens on the board', () => {
        const state = (0, initialState_1.createInitialState)(false);
        const onBoard = state.board.filter(c => c !== null).length;
        expect(onBoard).toBe(TOTAL_TOKENS);
    });
    it('bag is empty at start (all tokens placed on board)', () => {
        const state = (0, initialState_1.createInitialState)(false);
        expect((0, helpers_1.totalTokens)(state.bag)).toBe(0);
        expect(state.bag).toEqual((0, helpers_1.emptyPool)());
    });
    it('board has exactly 25 cells', () => {
        const state = (0, initialState_1.createInitialState)(false);
        expect(state.board).toHaveLength(25);
    });
    it('pyramid has correct card counts per level', () => {
        const state = (0, initialState_1.createInitialState)(false);
        expect(state.pyramid.level1).toHaveLength(helpers_1.PYRAMID_LEVEL1_COUNT);
        expect(state.pyramid.level2).toHaveLength(helpers_1.PYRAMID_LEVEL2_COUNT);
        expect(state.pyramid.level3).toHaveLength(helpers_1.PYRAMID_LEVEL3_COUNT);
    });
    it('starts in optional_privilege phase with player 0 as current player', () => {
        const state = (0, initialState_1.createInitialState)(false);
        expect(state.phase).toBe('optional_privilege');
        expect(state.currentPlayer).toBe(0);
    });
    it('no winner and no pending abilities at start', () => {
        const state = (0, initialState_1.createInitialState)(false);
        expect(state.winner).toBeNull();
        expect(state.winCondition).toBeNull();
        expect(state.pendingAbility).toBeNull();
        expect(state.pendingCrownCheck).toBe(false);
    });
    it('without second-player privilege: all 3 privileges on table, players have 0', () => {
        const state = (0, initialState_1.createInitialState)(false);
        expect(state.privileges).toBe(3);
        expect(state.players[0].privileges).toBe(0);
        expect(state.players[1].privileges).toBe(0);
        expect((0, helpers_1.totalPrivileges)(state)).toBe(3);
    });
    it('with second-player privilege: player 1 has 1, table has 2', () => {
        const state = (0, initialState_1.createInitialState)(true);
        expect(state.players[0].privileges).toBe(0);
        expect(state.players[1].privileges).toBe(1);
        expect(state.privileges).toBe(2);
        expect((0, helpers_1.totalPrivileges)(state)).toBe(3);
    });
    it('token conservation: total tokens per color match starting counts', () => {
        const state = (0, initialState_1.createInitialState)(false);
        const byColor = (0, helpers_1.totalTokensByColor)(state);
        expect(byColor.black).toBe(helpers_1.STARTING_GEM_COUNT);
        expect(byColor.red).toBe(helpers_1.STARTING_GEM_COUNT);
        expect(byColor.green).toBe(helpers_1.STARTING_GEM_COUNT);
        expect(byColor.blue).toBe(helpers_1.STARTING_GEM_COUNT);
        expect(byColor.white).toBe(helpers_1.STARTING_GEM_COUNT);
        expect(byColor.pearl).toBe(helpers_1.STARTING_PEARL_COUNT);
        expect(byColor.gold).toBe(helpers_1.STARTING_GOLD_COUNT);
    });
    it('repeatTurn is false at start', () => {
        const state = (0, initialState_1.createInitialState)(false);
        expect(state.repeatTurn).toBe(false);
    });
});
//# sourceMappingURL=initialState.test.js.map