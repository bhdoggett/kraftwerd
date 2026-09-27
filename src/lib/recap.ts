import { cellKey, makeBoard, type TileSpec } from "../../shared/engine/board";
import { runsThrough } from "../../shared/engine/runs";
import { boardAfter } from "./replay";

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

/** One place a turn played, and the words it made there. */
export interface PlaySpot {
  cells: Set<string>;
  words: string[];
}

/**
 * A turn split into the separate places it was played, in reading order: top
 * to bottom, then left to right.
 *
 * A turn can lay words in more than one part of the board, and replaying them
 * all at once says where but not what went with what. Tiles belong to one
 * spot when they share a word this turn made -- so tiles side by side stay
 * together, as do tiles bridged by a letter already on the board, and a play
 * that only works as a whole, like an L closing a square, is never pulled
 * apart. Two spots share no word, so each reads as a play of its own.
 *
 * `after` is the board with the whole turn on it.
 */
export function playSpots(
  after: readonly TileSpec[],
  placements: readonly { x: number; y: number }[],
): PlaySpot[] {
  const board = makeBoard([...after]);
  const keys = placements.map((p) => cellKey(p.x, p.y));
  const parent = new Map(keys.map((k) => [k, k]));
  const find = (k: string): string => {
    const up = parent.get(k)!;
    if (up === k) return k;
    const root = find(up);
    parent.set(k, root);
    return root;
  };

  const runs = runsThrough(board, placements);
  for (const run of runs) {
    const mine = run.cells.map((c) => cellKey(c.x, c.y)).filter((k) => parent.has(k));
    for (const k of mine.slice(1)) parent.set(find(k), find(mine[0]));
  }

  const groups = new Map<string, Set<string>>();
  for (const k of keys) {
    const root = find(k);
    const cells = groups.get(root) ?? new Set<string>();
    cells.add(k);
    groups.set(root, cells);
  }

  const topLeft = (cells: Set<string>) =>
    [...cells]
      .map((k) => k.split(",").map(Number) as [number, number])
      .reduce((best, [x, y]) => (y < best[1] || (y === best[1] && x < best[0]) ? [x, y] : best));

  return [...groups.values()]
    .map((cells) => ({
      cells,
      words: runs
        .filter((r) => r.cells.some((c) => cells.has(cellKey(c.x, c.y))))
        .map((r) => r.word),
    }))
    .sort((a, b) => {
      const [ax, ay] = topLeft(a.cells);
      const [bx, by] = topLeft(b.cells);
      return ay - by || ax - bx;
    });
}

/** One step of a replay: a spot of a turn, with where it sits in the history. */
export interface SpotStep extends PlaySpot {
  turnNumber: number;
  /** The turn's index in the history. */
  at: number;
  /** Every square of this turn shown so far, this spot's included. */
  upTo: Set<string>;
  /** The turn's last spot, which is where its points are said. */
  last: boolean;
}

/** The plays as replay steps, a spot at a time (`playSpots`). */
export function spotSteps(
  history: readonly (Parameters<typeof boardAfter>[0][number] & { turnNumber: number })[],
  plays: readonly { turnNumber: number }[],
): SpotStep[] {
  return plays.flatMap((play) => {
    const at = history.findIndex((t) => t.turnNumber === play.turnNumber);
    const turn = history[at];
    if (turn === undefined) return [];
    const spots = playSpots(boardAfter(history, at + 1), turn.placements);
    const upTo = new Set<string>();
    return spots.map((spot, i) => {
      for (const k of spot.cells) upTo.add(k);
      return {
        ...spot,
        turnNumber: play.turnNumber,
        at,
        upTo: new Set(upTo),
        last: i === spots.length - 1,
      };
    });
  });
}

