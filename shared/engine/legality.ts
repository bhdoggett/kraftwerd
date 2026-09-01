import { STACK_CAP } from "../config.js";
import { cellKey, type Board } from "./board.js";
import { runsThrough } from "./runs.js";
import type { Placement } from "./score.js";

export interface Dictionary {
  has(word: string): boolean;
}

/**
 * The board a turn is played on, and what the caller vouches for.
 *
 * Mostly properties of the board itself -- how big it is, which squares are
 * blocked, where the centre is. `connected` is different in kind: it is not
 * something true of the board but an assertion by the caller that it has
 * already done a check `validateTurn` would otherwise do. Read its own comment
 * before setting it.
 */
export interface Bounds {
  width: number;
  height: number;
  /** Squares no tile may occupy, as `cellKey` strings. */
  blocked?: ReadonlySet<string>;
  /** The opening play must cover this square. */
  centre?: { x: number; y: number };
  /**
   * Skip the whole-board connectivity walk. The caller asserts the result.
   *
   * Set this only if all four of these hold. They are what make skipping the
   * walk sound, and none of them is checked:
   *
   * 1. The placements, together with any board tiles among them, fill one
   *    unbroken straight line -- no gaps, and not two separate clusters. Two
   *    clusters, one abutting the mass and one floating free, satisfy "the
   *    move touches the mass" and are still disconnected.
   * 2. That line overlaps or orthogonally abuts the tiles already down (or the
   *    board is empty, in which case the line is the whole mass).
   * 3. No square in the line is blocked, so the line really is contiguous on
   *    the shape being played. Note `blocked` is *not* consulted by the bot's
   *    `fit`; its caller screens the span first.
   * 4. The board before the move was itself one mass.
   *
   * The bot's single-span search establishes all of these -- `fit` fills every
   * position of its span and rejects a span that neither overlaps nor abuts the
   * mass, and `components` rejects a span holding a blocked square before `fit`
   * ever sees it. A caller that assembles placements from more than one region
   * does not, and must leave this unset.
   *
   * It is worth the care: the walk crosses the whole board, once for every one
   * of the thousands of candidates the search weighs in a turn, and measured at
   * a quarter of the search's entire running time. The move is still checked in
   * every other respect.
   */
  connected?: boolean;
}

/**
 * One thing wrong with a turn.
 *
 * A turn can be wrong in more than one way at once -- disconnected and
 * spelling something that is not a word, say -- so these are collected rather
 * than reported one at a time. At most one of each kind: three tiles off the
 * board is one thing to fix, not three.
 */
export type Fault =
  | { reason: "empty-turn" }
  | { reason: "out-of-bounds"; at: { x: number; y: number } }
  | { reason: "duplicate-cell"; at: { x: number; y: number } }
  | { reason: "stack-full"; at: { x: number; y: number } }
  | { reason: "blocked"; at: { x: number; y: number } }
  | { reason: "missing-centre" }
  | { reason: "disconnected" }
  | { reason: "invalid-words"; words: string[] }
  | { reason: "erased"; words: string[] }
  | { reason: "unchanged"; at: { x: number; y: number } }
  | { reason: "blank-on-stack"; at: { x: number; y: number } };

export type Legality = { ok: true } | { ok: false; faults: Fault[] };

/** The first of each kind, in the order they were found. */
function oneOfEach(faults: readonly Fault[]): Fault[] {
  const seen = new Set<Fault["reason"]>();
  return faults.filter((fault) => {
    if (seen.has(fault.reason)) return false;
    seen.add(fault.reason);
    return true;
  });
}

const NEIGHBOURS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
] as const;

/**
 * Whether every tile forms a single orthogonally-connected mass, starting from
 * `from` when given — the centre, so growth is traceable back to the opening
 * word rather than to whichever tile the map happened to yield first.
 */
function isOneMass(board: Board, from?: string): boolean {
  const start = from !== undefined && board.has(from) ? { done: false, value: from } : board.keys().next();
  if (start.done === true) return true;

  const seen = new Set<string>([start.value]);
  const queue = [start.value.split(",").map(Number) as [number, number]];

  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    for (const { dx, dy } of NEIGHBOURS) {
      const key = cellKey(x + dx, y + dy);
      if (!board.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push([x + dx, y + dy]);
    }
  }

  return seen.size === board.size;
}

/**
 * Words already on the board that this turn would cover completely.
 *
 * A tile may land on a tile, but a word has to survive being built over: at
 * least one of its letters must still be standing afterwards. Otherwise a
 * long word could simply be paved over and replayed for full value, and the
 * board would lose its history a word at a time.
 */
function wordsBuriedWhole(
  before: Board,
  placements: readonly Placement[],
): string[] {
  const covered = placements
    .map((p) => ({ x: p.x, y: p.y }))
    .filter((p) => before.has(cellKey(p.x, p.y)));
  if (covered.length === 0) return [];

  const coveredKeys = new Set(covered.map((c) => cellKey(c.x, c.y)));

  return runsThrough(before, covered)
    .filter((run) => run.cells.every((c) => coveredKeys.has(cellKey(c.x, c.y))))
    .map((run) => run.word);
}

/** The board as it stands after `placements` are applied to `before`. */
export function applyPlacements(before: Board, placements: readonly Placement[]): Board {
  const next = new Map(before);
  for (const p of placements) {
    const key = cellKey(p.x, p.y);
    const stacked = (before.get(key)?.stacked ?? 0) + 1;
    next.set(key, { letter: p.letter, isBlank: p.isBlank, stacked });
  }
  return next;
}

/**
 * Every word this turn puts on the board and so must be in the dictionary.
 *
 * Runs of 2+ count as words. A tile with no neighbours forms no such run and
 * is checked on its own letter instead -- reachable only on the opening play,
 * since connectivity gives every later tile a neighbour.
 *
 * Exported so a caller holding the dictionary out of process (Convex) can
 * fetch just these words instead of loading all 59k.
 */
export function wordsFormed(after: Board, placements: readonly Placement[]): string[] {
  const runs = runsThrough(after, placements);
  const covered = new Set(runs.flatMap((r) => r.cells.map((c) => cellKey(c.x, c.y))));
  const lone = placements
    .filter((p) => !covered.has(cellKey(p.x, p.y)))
    .map((p) => p.letter.toUpperCase());

  return [...runs.map((r) => r.word), ...lone];
}

/** Whether `placements` form a legal turn against `before` (design.md §3). */
export function validateTurn(
  before: Board,
  placements: readonly Placement[],
  dictionary: Dictionary,
  bounds: Bounds,
): Legality {
  if (placements.length === 0) return { ok: false, faults: [{ reason: "empty-turn" }] };

  /*
   * Where the tiles are: whether each one may occupy the square it is on.
   *
   * Checked across every placement before anything is concluded from the
   * board they would make. A tile on a square it cannot have leaves that
   * board meaningless -- two tiles claiming one square, or a letter sitting
   * outside the grid -- so these are answered on their own, and the words are
   * not second-guessed until the tiles are somewhere they could be.
   */
  const misplaced: Fault[] = [];
  const claimed = new Set<string>();
  for (const p of placements) {
    const at = { x: p.x, y: p.y };
    const key = cellKey(p.x, p.y);

    if (p.x < 0 || p.y < 0 || p.x >= bounds.width || p.y >= bounds.height) {
      misplaced.push({ reason: "out-of-bounds", at });
      continue;
    }
    if (bounds.blocked?.has(key) === true) {
      misplaced.push({ reason: "blocked", at });
      continue;
    }
    if (claimed.has(key)) {
      misplaced.push({ reason: "duplicate-cell", at });
      continue;
    }
    claimed.add(key);

    // One fault per tile, hence the continues: a square that is full and holds
    // the letter you are laying on it is one square to move off, not two
    // things to read.
    //
    // Laying a letter back on itself leaves the board exactly as it was, and
    // would collect for every word the square sits in a second time. A tile
    // that lands on a tile has to change it.
    if (before.get(key)?.letter === p.letter) {
      misplaced.push({ reason: "unchanged", at });
      continue;
    }

    // A square holds at most STACK_CAP tiles over its lifetime, this one
    // included. Once it is full, nothing may land there again.
    const priorStack = before.get(key)?.stacked ?? 0;
    if (priorStack >= STACK_CAP) {
      misplaced.push({ reason: "stack-full", at });
      continue;
    }

    /*
     * A blank may not be the tile that closes a square.
     *
     * Blanks score like letters now, and a square that is full cannot be
     * answered — so closing one with a tile that can be any letter would let
     * a player end an argument they could not otherwise win. Starting a
     * square with a blank is fine: the next player can still build on it.
     */
    if (p.isBlank && priorStack + 1 >= STACK_CAP && priorStack > 0) {
      misplaced.push({ reason: "blank-on-stack", at });
      continue;
    }
  }

  if (misplaced.length > 0) return { ok: false, faults: oneOfEach(misplaced) };

  const after = applyPlacements(before, placements);
  const faults: Fault[] = [];

  // The opening word starts at the centre, as in a crossword. Everything after
  // it is anchored by connectivity to that first word.
  if (before.size === 0 && bounds.centre !== undefined) {
    const centre = cellKey(bounds.centre.x, bounds.centre.y);
    if (!placements.some((p) => cellKey(p.x, p.y) === centre)) {
      faults.push({ reason: "missing-centre" });
    }
  }

  const from = bounds.centre === undefined ? undefined : cellKey(bounds.centre.x, bounds.centre.y);
  if (bounds.connected !== true && !isOneMass(after, from)) {
    faults.push({ reason: "disconnected" });
  }

  const buried = wordsBuriedWhole(before, placements);
  if (buried.length > 0) faults.push({ reason: "erased", words: [...new Set(buried)] });

  const bad = wordsFormed(after, placements).filter((w) => !dictionary.has(w));
  if (bad.length > 0) faults.push({ reason: "invalid-words", words: [...new Set(bad)] });

  return faults.length === 0 ? { ok: true } : { ok: false, faults };
}
