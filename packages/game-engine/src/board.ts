import { BOARD_WIDTH, BOARD_HEIGHT, MAX_TOKENS_IN_LINE } from './helpers';

/**
 * Board topology for Splendor Duel.
 *
 * The board is a 5×5 grid (25 cells, indices 0–24, row-major).
 * Tokens are placed in a clockwise spiral starting from the center cell.
 * Adjacency is 8-directional (horizontal, vertical, diagonal).
 */

// ─── Spiral order ─────────────────────────────────────────────────────────────

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
export const SPIRAL_ORDER: number[] = [
  12,                              // center
  13, 18, 17, 16, 11, 6, 7, 8,    // ring 1 (clockwise from right)
  9, 14, 19, 24, 23, 22, 21, 20,  // ring 2 (clockwise from right)
  15, 10, 5, 0, 1, 2, 3, 4,       // ring 2 continued
];

// ─── Coordinate helpers ───────────────────────────────────────────────────────

export function indexToCoord(index: number): [number, number] {
  return [Math.floor(index / BOARD_WIDTH), index % BOARD_WIDTH];
}

export function coordToIndex(row: number, col: number): number {
  return row * BOARD_WIDTH + col;
}

// ─── Adjacency ────────────────────────────────────────────────────────────────

/** Returns all valid board indices adjacent (8-directional) to the given index. */
export function adjacentCells(index: number): number[] {
  const [row, col] = indexToCoord(index);
  const neighbors: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < BOARD_HEIGHT && c >= 0 && c < BOARD_WIDTH) {
        neighbors.push(coordToIndex(r, c));
      }
    }
  }
  return neighbors;
}

/**
 * Returns true if the given indices form a valid straight line
 * (horizontal, vertical, or diagonal) of 1–MAX_TOKENS_IN_LINE cells, all adjacent in sequence,
 * with no gaps.
 */
export function isValidTokenLine(indices: number[]): boolean {
  if (indices.length < 1 || indices.length > MAX_TOKENS_IN_LINE) return false;
  if (indices.length === 1) return true;

  const coords = indices.map(indexToCoord);

  // Determine direction from first two cells
  const dr = coords[1][0] - coords[0][0];
  const dc = coords[1][1] - coords[0][1];

  // Direction must be unit step (-1, 0, or 1)
  if (Math.abs(dr) > 1 || Math.abs(dc) > 1) return false;
  if (dr === 0 && dc === 0) return false;

  // All subsequent cells must follow the same direction
  for (let i = 2; i < coords.length; i++) {
    if (coords[i][0] - coords[i - 1][0] !== dr) return false;
    if (coords[i][1] - coords[i - 1][1] !== dc) return false;
  }

  return true;
}
