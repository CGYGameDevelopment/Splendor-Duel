/**
 * Board topology for Splendor Duel.
 *
 * The board is a 5×5 grid (25 cells, indices 0–24, row-major).
 * Tokens are placed in a clockwise spiral starting from the center cell.
 * Adjacency is 8-directional (horizontal, vertical, diagonal).
 */
/**
 * SPIRAL_ORDER[i] is the board cell index of the i-th spiral position.
 * Position 0 = center cell (index 12).
 * The spiral proceeds clockwise outward.
 *
 * Grid layout (row, col):
 *   (0,0) (0,1) (0,2) (0,3) (0,4)   →  indices  0– 4
 *   (1,0) (1,1) (1,2) (1,3) (1,4)   →  indices  5– 9
 *   (2,0) (2,1) (2,2) (2,3) (2,4)   →  indices 10–14
 *   (3,0) (3,1) (3,2) (3,3) (3,4)   →  indices 15–19
 *   (4,0) (4,1) (4,2) (4,3) (4,4)   →  indices 20–24
 */
export declare const SPIRAL_ORDER: number[];
export declare function indexToCoord(index: number): [number, number];
export declare function coordToIndex(row: number, col: number): number;
/** Returns all valid board indices adjacent (8-directional) to the given index. */
export declare function adjacentCells(index: number): number[];
/**
 * Returns true if the given indices form a valid straight line
 * (horizontal, vertical, or diagonal) of 1–MAX_TOKENS_IN_LINE cells, all adjacent in sequence,
 * with no gaps.
 */
export declare function isValidTokenLine(indices: number[]): boolean;
//# sourceMappingURL=board.d.ts.map