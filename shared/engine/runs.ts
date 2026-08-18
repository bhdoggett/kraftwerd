import { cellKey, type Board, type Coord } from "./board.js";

export interface Run {
  word: string;
  cells: Coord[];
}

const AXES = [
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
] as const;

/**
 * Every maximal contiguous run of length >= 2, horizontal and vertical,
 * that passes through at least one of `placements`.
 */
export function runsThrough(board: Board, placements: readonly Coord[]): Run[] {
  const runs: Run[] = [];
  const seen = new Set<string>();

  for (const { dx, dy } of AXES) {
    for (const { x, y } of placements) {
      let sx = x;
      let sy = y;
      while (board.has(cellKey(sx - dx, sy - dy))) {
        sx -= dx;
        sy -= dy;
      }

      const id = `${dx},${dy}:${cellKey(sx, sy)}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const cells: Coord[] = [];
      let word = "";
      for (let cx = sx, cy = sy; board.has(cellKey(cx, cy)); cx += dx, cy += dy) {
        cells.push({ x: cx, y: cy });
        word += board.get(cellKey(cx, cy))!.letter;
      }

      if (cells.length >= 2) runs.push({ word, cells });
    }
  }

  return runs;
}
