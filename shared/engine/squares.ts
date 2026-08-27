import { cellKey, type Board, type Coord } from "./board.js";

function isFilled(board: Board, ox: number, oy: number, k: number): boolean {
  for (let y = oy; y < oy + k; y++) {
    for (let x = ox; x < ox + k; x++) {
      if (!board.has(cellKey(x, y))) return false;
    }
  }
  return true;
}

/**
 * Sizes of every filled k x k block (k >= 2) that this turn brought into
 * existence.
 *
 * A block counts as new iff it is filled now and was not filled before. That
 * used to be the same question as "does it contain a placed cell", because
 * placements only ever added tiles — but a tile can now land on top of one,
 * so a block can contain this turn's work and still have been complete all
 * along. Those pay nothing: the square was already somebody's.
 */
export interface SquareBlock {
  /** Side length. */
  k: number;
  /** Top-left corner. */
  x: number;
  y: number;
}

/** As `newSquares`, but saying where each block is — which is what a scorer
 * needs to know whether a block was already complete before a turn. */
export function newSquareBlocks(
  before: Board,
  after: Board,
  placements: readonly Coord[],
): SquareBlock[] {
  // A k x k block needs k^2 tiles, so nothing larger than this can be filled.
  const maxSize = Math.floor(Math.sqrt(after.size));
  const found: SquareBlock[] = [];
  const seen = new Set<string>();

  for (const p of placements) {
    for (let k = 2; k <= maxSize; k++) {
      // Blocks of size k containing p are anchored at (p.x - i, p.y - j).
      for (let j = 0; j < k; j++) {
        for (let i = 0; i < k; i++) {
          const ox = p.x - i;
          const oy = p.y - j;
          const id = `${ox},${oy},${k}`;
          if (seen.has(id)) continue;
          seen.add(id);
          if (isFilled(after, ox, oy, k) && !isFilled(before, ox, oy, k)) {
            found.push({ k, x: ox, y: oy });
          }
        }
      }
    }
  }

  return found;
}

export function newSquares(
  before: Board,
  after: Board,
  placements: readonly Coord[],
): number[] {
  return newSquareBlocks(before, after, placements).map((block) => block.k);
}
