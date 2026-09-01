import { cellKey } from "../../shared/engine/board";

/** A tile on the board, as the game view reports it. */
interface PlacedTile {
  x: number;
  y: number;
  placedBy: string;
  /** Which turn put it there. */
  turnNumber: number;
}

/**
 * The squares played since your last turn.
 *
 * A game you come back to hours later is a board you have to re-read, and at
 * a table of four there may be three plays on it you have never seen. This is
 * the answer to "what changed while I was gone", which is the question you
 * actually arrive with.
 *
 * Before your first turn there is no "since" to measure from, so it is the
 * play before yours on its own rather than a board lit up end to end.
 */
export function playedSinceYourTurn(
  tiles: readonly PlacedTile[],
  you: string,
): Set<string> {
  if (tiles.length === 0) return new Set();

  const latest = tiles.reduce((max, t) => Math.max(max, t.turnNumber), 0);
  const yours = tiles
    .filter((t) => t.placedBy === you)
    .reduce((max, t) => Math.max(max, t.turnNumber), 0);

  const since = yours > 0 ? yours : latest - 1;
  return new Set(
    tiles.filter((t) => t.turnNumber > since).map((t) => cellKey(t.x, t.y)),
  );
}
