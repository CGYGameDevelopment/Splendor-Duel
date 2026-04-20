import { createInitialState } from '../initialState';
import { totalTokens, emptyPool, totalPrivileges, totalTokensByColor, PYRAMID_LEVEL1_COUNT, PYRAMID_LEVEL2_COUNT, PYRAMID_LEVEL3_COUNT, STARTING_GEM_COUNT, STARTING_PEARL_COUNT, STARTING_GOLD_COUNT } from '../helpers';

const TOTAL_TOKENS = STARTING_GEM_COUNT * 5 + STARTING_PEARL_COUNT + STARTING_GOLD_COUNT;

describe('createInitialState', () => {
  it('places exactly the correct total number of tokens on the board', () => {
    const state = createInitialState(false);
    const onBoard = state.board.filter(c => c !== null).length;
    expect(onBoard).toBe(TOTAL_TOKENS);
  });

  it('bag is empty at start (all tokens placed on board)', () => {
    const state = createInitialState(false);
    expect(totalTokens(state.bag)).toBe(0);
    expect(state.bag).toEqual(emptyPool());
  });

  it('board has exactly 25 cells', () => {
    const state = createInitialState(false);
    expect(state.board).toHaveLength(25);
  });

  it('pyramid has correct card counts per level', () => {
    const state = createInitialState(false);
    expect(state.pyramid.level1).toHaveLength(PYRAMID_LEVEL1_COUNT);
    expect(state.pyramid.level2).toHaveLength(PYRAMID_LEVEL2_COUNT);
    expect(state.pyramid.level3).toHaveLength(PYRAMID_LEVEL3_COUNT);
  });

  it('starts in mandatory phase with player 0 as current player (bag empty, no privileges)', () => {
    const state = createInitialState(false);
    expect(state.phase).toBe('mandatory');
    expect(state.currentPlayer).toBe(0);
  });

  it('no winner and no pending abilities at start', () => {
    const state = createInitialState(false);
    expect(state.winner).toBeNull();
    expect(state.winCondition).toBeNull();
    expect(state.pendingAbility).toBeNull();
    expect(state.pendingCrownCheck).toBe(false);
  });

  it('without second-player privilege: all 3 privileges on table, players have 0', () => {
    const state = createInitialState(false);
    expect(state.privileges).toBe(3);
    expect(state.players[0].privileges).toBe(0);
    expect(state.players[1].privileges).toBe(0);
    expect(totalPrivileges(state)).toBe(3);
  });

  it('with second-player privilege: player 1 has 1, table has 2', () => {
    const state = createInitialState(true);
    expect(state.players[0].privileges).toBe(0);
    expect(state.players[1].privileges).toBe(1);
    expect(state.privileges).toBe(2);
    expect(totalPrivileges(state)).toBe(3);
  });

  it('token conservation: total tokens per color match starting counts', () => {
    const state = createInitialState(false);
    const byColor = totalTokensByColor(state);
    expect(byColor.black).toBe(STARTING_GEM_COUNT);
    expect(byColor.red).toBe(STARTING_GEM_COUNT);
    expect(byColor.green).toBe(STARTING_GEM_COUNT);
    expect(byColor.blue).toBe(STARTING_GEM_COUNT);
    expect(byColor.white).toBe(STARTING_GEM_COUNT);
    expect(byColor.pearl).toBe(STARTING_PEARL_COUNT);
    expect(byColor.gold).toBe(STARTING_GOLD_COUNT);
  });

  it('repeatTurn is false at start', () => {
    const state = createInitialState(false);
    expect(state.repeatTurn).toBe(false);
  });
});
