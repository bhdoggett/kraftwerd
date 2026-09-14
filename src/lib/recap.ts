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

/**
 * The latest play by anyone but you, as the squares it covers.
 *
 * For a play landing while you watch: it is the newest thing on the board, so
 * every tile it laid is on top and the board alone says where it went. Null
 * when nobody else has played.
 */
export function latestPlayByOthers(
  tiles: readonly PlacedTile[],
  you: string,
): RecapPlay | null {
  const theirs = tiles.filter((t) => t.placedBy !== you);
  if (theirs.length === 0) return null;

  const turnNumber = theirs.reduce((max, t) => Math.max(max, t.turnNumber), 0);
  return {
    turnNumber,
    cells: new Set(
      theirs.filter((t) => t.turnNumber === turnNumber).map((t) => cellKey(t.x, t.y)),
    ),
  };
}

/** A turn as the history reports it: whose it was, and where its tiles went. */
interface HistoryTurn {
  turnNumber: number;
  userId: string;
  placements: readonly { x: number; y: number }[];
}

/**
 * The same plays, read off the turn history rather than the board.
 *
 * The board only says who owns each square now: a tile the next play built on
 * counts as the next play's, and a play covered entirely is gone from it. The
 * history remembers every placement, which is what a replay that rewinds the
 * board needs to mark each play where it actually went.
 *
 * "Since your turn" is your last turn of any kind here -- a trade or a pass
 * was still a turn you saw the board on. Before your first, it is the play
 * before yours on its own, as it is for the board.
 */
export function playsInHistorySinceYourTurn(
  turns: readonly HistoryTurn[],
  you: string,
): RecapPlay[] {
  const yours = turns.filter((t) => t.userId === you).map((t) => t.turnNumber);
  const played = turns
    .filter((t) => t.placements.length > 0)
    .sort((a, b) => a.turnNumber - b.turnNumber);

  const since = yours.length > 0 ? Math.max(...yours) : null;
  const plays = since === null ? played.slice(-1) : played.filter((t) => t.turnNumber > since);

  return plays.map((t) => ({
    turnNumber: t.turnNumber,
    cells: new Set(t.placements.map((p) => cellKey(p.x, p.y))),
  }));
}
