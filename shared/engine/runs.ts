import { cellKey, type Board, type Coord } from "./board.js";

interface Run {
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

/**
 * The runs a turn forms, and the placed tiles none of them covers.
 *
 * A tile with no neighbours forms no run. It still has to be a word on its own
 * letter -- reachable only on the opening play, since connectivity gives every
 * later tile a neighbour -- so checking a turn and scoring one both need it
 * told apart from the rest.
 */
export function runsAndLoners<P extends Coord>(
  board: Board,
  placements: readonly P[],
): { runs: Run[]; lone: P[] } {
  const runs = runsThrough(board, placements);
  const covered = new Set(runs.flatMap((r) => r.cells.map((c) => cellKey(c.x, c.y))));
  return { runs, lone: placements.filter((p) => !covered.has(cellKey(p.x, p.y))) };
}
