import { SCORING_SQUARE_SIZE } from "../config.js";
import type { BoardShape } from "../boards.js";
import { cellKey, type Board, type Coord } from "./board.js";

/** A 3x3 one tile from complete: its top-left corner and the square still empty. */
export interface NearSquare {
  x: number;
  y: number;
  gap: Coord;
}

/**
 * The 3x3 blocks this move leaves exactly one tile short.
 *
 * Only blocks the move touches: anything further away was already that way
 * before the move and is not this move's doing -- the same locality
 * `newSquareBlocks` in squares.ts relies on. A block with a blocked square in
 * it can never close, so it is never one tile short.
 *
 * Shared by the bot's own caution (`exposure` in shared/sim/judgement.ts) and
 * by the coach, which warns a player about the same thing.
 */
export function nearSquares(
  before: Board,
  placements: readonly Coord[],
  shape: Pick<BoardShape, "blocked">,
  size: number,
): NearSquare[] {
  const k = SCORING_SQUARE_SIZE;
  const laid = new Set(placements.map((p) => cellKey(p.x, p.y)));
  const filled = (x: number, y: number) =>
    laid.has(cellKey(x, y)) || before.has(cellKey(x, y));

  const found: NearSquare[] = [];
  const seen = new Set<string>();
  for (const p of placements) {
    for (let j = 0; j < k; j++) {
      for (let i = 0; i < k; i++) {
        const ox = p.x - i;
        const oy = p.y - j;
        if (ox < 0 || oy < 0 || ox + k > size || oy + k > size) continue;
        const id = `${ox},${oy}`;
        if (seen.has(id)) continue;
        seen.add(id);

        let gap: Coord | null = null;
        let gaps = 0;
        let blocked = false;
        for (let dy = 0; dy < k && !blocked && gaps <= 1; dy++) {
          for (let dx = 0; dx < k; dx++) {
            const x = ox + dx;
            const y = oy + dy;
            if (shape.blocked.has(cellKey(x, y))) {
              blocked = true;
              break;
            }
            if (!filled(x, y)) {
              gaps++;
              gap = { x, y };
            }
          }
        }
        if (!blocked && gaps === 1 && gap !== null) found.push({ x: ox, y: oy, gap });
      }
    }
  }
  return found;
}
