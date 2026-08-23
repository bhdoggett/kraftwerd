import { RACK_OUT_BONUS } from "../config.js";
import { cellKey, type Board, type Coord } from "./board.js";
import { runsThrough } from "./runs.js";
import { newSquareBlocks } from "./squares.js";

export interface Placement extends Coord {
  letter: string;
  isBlank: boolean;
}

export interface ScoredWord {
  word: string;
  /** Letters that count: blanks are worth nothing wherever they sit. */
  points: number;
}

export interface TurnScore {
  /** Every letter of every word the play forms, existing tiles included. */
  wordPoints: number;
  words: ScoredWord[];
  squarePoints: number;
  squares: number[];
  /** RACK_OUT_BONUS if this turn emptied the rack without a blank, else 0. */
  rackOutBonus: number;
  total: number;
}

/**
 * Score a turn against the board as it stands *after* the placement.
 *
 * Words pay for all their letters, not only the ones just added, so extending
 * what is already on the board is worth doing. That also means a word left
 * extendable is a liability: the next player collects its whole length for one
 * tile, the same way an open corner hands away a square.
 *
 * Squares pay k^2 on top, counting nested sub-squares.
 */
export interface ScoreOptions {
  /**
   * Squares whose letter belongs to the board. A word running through one is
   * worth double, and so is a square of tiles containing one — the point of
   * walking the board out to a corner. A covered corner is not in here: its
   * letter is gone, and so is its bonus.
   */
  premium?: ReadonlyMap<string, string>;
  /**
   * The board before the turn. Only squares that were not already complete
   * pay, and with tiles landing on top of tiles that can no longer be worked
   * out from the placements alone. Defaults to the board without them, which
   * is what it used to mean when a placement could only ever fill an empty
   * square.
   */
  before?: Board;
  /**
   * Whether this turn played every letter in the rack, using none of them as
   * a blank. The caller decides this -- it is a fact about the player's hand,
   * which the board knows nothing about.
   */
  rackOut?: boolean;
}

export function scoreTurn(
  board: Board,
  placements: readonly Placement[],
  options: ScoreOptions = {},
): TurnScore {
  const premium = options.premium ?? new Map<string, string>();
  const before =
    options.before ??
    new Map([...board].filter(([key]) => !placements.some((p) => cellKey(p.x, p.y) === key)));

  const runs = runsThrough(board, placements);
  const covered = new Set(runs.flatMap((r) => r.cells.map((c) => cellKey(c.x, c.y))));

  const scoreCells = (cells: readonly Coord[]) =>
    cells.filter((c) => board.get(cellKey(c.x, c.y))?.isBlank === false).length;

  /** How many premium squares a set of cells covers: each one doubles. */
  const doubling = (cells: readonly Coord[]) =>
    cells.filter((c) => premium.has(cellKey(c.x, c.y))).length;

  const words: ScoredWord[] = runs.map((run) => ({
    word: run.word,
    points: scoreCells(run.cells) * 2 ** doubling(run.cells),
  }));

  // A tile touching nothing forms no run. It still has to be a word in its own
  // right to be legal, so it scores as one.
  for (const p of placements) {
    if (covered.has(cellKey(p.x, p.y))) continue;
    words.push({ word: p.letter.toUpperCase(), points: p.isBlank ? 0 : 1 });
  }

  const wordPoints = words.reduce((sum, w) => sum + w.points, 0);
  const blocks = newSquareBlocks(before, board, placements);
  const squares = blocks.map((block) => block.k);

  // A square pays double for every premium letter inside it, which is what a
  // 2x2 built onto a corner is worth going for: four becomes eight.
  const squarePoints = blocks.reduce((sum, block) => {
    const cells: Coord[] = [];
    for (let y = block.y; y < block.y + block.k; y++) {
      for (let x = block.x; x < block.x + block.k; x++) cells.push({ x, y });
    }
    return sum + block.k * block.k * 2 ** doubling(cells);
  }, 0);

  const rackOutBonus = options.rackOut === true ? RACK_OUT_BONUS : 0;

  return {
    wordPoints,
    words,
    squarePoints,
    squares,
    rackOutBonus,
    total: wordPoints + squarePoints + rackOutBonus,
  };
}
