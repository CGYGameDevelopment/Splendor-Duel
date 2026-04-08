import { isValidTokenLine, adjacentCells, SPIRAL_ORDER, indexToCoord } from '../board';

describe('SPIRAL_ORDER', () => {
  test('has 25 unique entries covering all board cells', () => {
    expect(SPIRAL_ORDER).toHaveLength(25);
    expect(new Set(SPIRAL_ORDER).size).toBe(25);
    expect(Math.min(...SPIRAL_ORDER)).toBe(0);
    expect(Math.max(...SPIRAL_ORDER)).toBe(24);
  });

  test('starts at center (index 12)', () => {
    expect(SPIRAL_ORDER[0]).toBe(12);
  });
});

describe('isValidTokenLine', () => {
  test('single cell is valid', () => {
    expect(isValidTokenLine([7])).toBe(true);
  });

  test('two horizontal adjacent cells', () => {
    expect(isValidTokenLine([0, 1])).toBe(true);
  });

  test('two vertical adjacent cells', () => {
    expect(isValidTokenLine([0, 5])).toBe(true);
  });

  test('two diagonal adjacent cells', () => {
    expect(isValidTokenLine([0, 6])).toBe(true);
  });

  test('three in a row horizontal', () => {
    expect(isValidTokenLine([0, 1, 2])).toBe(true);
  });

  test('three in a row vertical', () => {
    expect(isValidTokenLine([0, 5, 10])).toBe(true);
  });

  test('three in a diagonal', () => {
    expect(isValidTokenLine([0, 6, 12])).toBe(true);
  });

  test('non-adjacent cells are invalid', () => {
    expect(isValidTokenLine([0, 2])).toBe(false);
  });

  test('L-shape is invalid', () => {
    expect(isValidTokenLine([0, 1, 6])).toBe(false);
  });

  test('four cells is invalid', () => {
    expect(isValidTokenLine([0, 1, 2, 3])).toBe(false);
  });

  test('empty array is invalid', () => {
    expect(isValidTokenLine([])).toBe(false);
  });
});

describe('adjacentCells', () => {
  test('center cell (12) has 8 neighbors', () => {
    expect(adjacentCells(12)).toHaveLength(8);
  });

  test('corner cell (0) has 3 neighbors', () => {
    expect(adjacentCells(0)).toHaveLength(3);
  });

  test('edge cell (2) has 5 neighbors', () => {
    expect(adjacentCells(2)).toHaveLength(5);
  });
});
