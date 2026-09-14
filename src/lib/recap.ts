import { cellKey } from "../../shared/engine/board";

/** A tile on the board, as the game view reports it. */
interface PlacedTile {
  x: number;
  y: number;
  placedBy: string;
  /** Which turn put it there. */
  turnNumber: number;
}

/** One play to point out: which turn it was, and the squares it left showing. */
interface RecapPlay {
  turnNumber: number;
  cells: Set<string>;
}

/**
 * The plays made since your last turn, oldest first, each with the squares it
 * left showing.
 *
 * A game you come back to hours later is a board you have to re-read, and at
 * a table of three there may be two plays on it you have never seen. This is
 * the answer to "what changed while I was gone", which is the question you
 * actually arrive with -- a play at a time, in the order they were made,
 * because two players' tiles lit at once say where but not who went first.
 *
 * Before your first turn there is no "since" to measure from, so it is the
 * play before yours on its own rather than a board lit up end to end.
 */
export function playsSinceYourTurn(
  tiles: readonly PlacedTile[],
  you: string,
): RecapPlay[] {
  if (tiles.length === 0) return [];

  const latest = tiles.reduce((max, t) => Math.max(max, t.turnNumber), 0);
  const yours = tiles
    .filter((t) => t.placedBy === you)
    .reduce((max, t) => Math.max(max, t.turnNumber), 0);

  const since = yours > 0 ? yours : latest - 1;
  const byTurn = new Map<number, Set<string>>();
  for (const t of tiles) {
    if (t.turnNumber <= since) continue;
    const cells = byTurn.get(t.turnNumber) ?? new Set<string>();
    cells.add(cellKey(t.x, t.y));
    byTurn.set(t.turnNumber, cells);
  }
  return [...byTurn]
    .sort(([a], [b]) => a - b)
    .map(([turnNumber, cells]) => ({ turnNumber, cells }));
}
