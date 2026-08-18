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
 * A block counts as new iff at least one of its cells was empty before the
 * turn -- i.e. iff it contains at least one placed cell. Placements only ever
 * add tiles, so that test is exactly equivalent to diffing the square sets of
 * the board before and after, without needing the "before" board at all.
 */
export function newSquares(board: Board, placements: readonly Coord[]): number[] {
  // A k x k block needs k^2 tiles, so nothing larger than this can be filled.
  const maxSize = Math.floor(Math.sqrt(board.size));
  const found: number[] = [];
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
          if (isFilled(board, ox, oy, k)) found.push(k);
        }
      }
    }
  }

  return found;
}
