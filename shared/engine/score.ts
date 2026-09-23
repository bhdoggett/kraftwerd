import {
  LONG_WORD_BONUS,
  LONG_WORD_MIN,
  SQUARE_BONUS,
} from "../config.js";
import { cellKey, type Board, type Coord } from "./board.js";
import { runsAndLoners } from "./runs.js";
import { newSquareBlocks } from "./squares.js";

export interface Placement extends Coord {
  letter: string;
  isBlank: boolean;
}

interface ScoredWord {
  word: string;
  /** One point a letter, blanks included once they are on the board, doubled
   * for each fresh bonus square (see ScoreOptions.bonusSquares) it crosses. */
  points: number;
  /**
   * What a bonus square multiplied this word by -- 2 for one fresh square, 4
   * for two -- or absent when none applied. A number rather than a flag
   * because a word crossing two doubles twice, and a chip that said "x2"
   * about a quadrupled word would be wrong in the one place that explains
   * where the points came from.
   */
  bonus?: number;
  /** Earns LONG_WORD_BONUS: long enough, and new or made longer this turn. */
  long?: true;
}

export interface TurnScore {
  /** Every letter of every word the play forms, existing tiles included. */
  wordPoints: number;
  words: ScoredWord[];
  squarePoints: number;
  squares: number[];
  /** Flat bonus for each word of LONG_WORD_MIN letters or more (design.md §4.1). */
  longWordBonus: number;
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
 * Each completed SCORING_SQUARE_SIZE x SCORING_SQUARE_SIZE block pays a flat
 * SQUARE_BONUS on top, counting nested sub-squares; a word of LONG_WORD_MIN
 * letters or more pays a flat LONG_WORD_BONUS on top of its own points, so
 * long as the turn made it longer or new -- not for letters stacked into a
 * long word already standing.
 *
 * Nothing else pays. Landing on a stack and emptying the rack each carried a
 * bonus of their own until rules version 10. Stacking already earns its keep
 * by making words playable, and the words it makes score in full.
 */
interface ScoreOptions {
  /**
   * The board before the turn. Only squares that were not already complete
   * pay, and with tiles landing on top of tiles that can no longer be worked
   * out from the placements alone. Defaults to the board without them, which
   * is what it used to mean when a placement could only ever fill an empty
   * square.
   */
  before?: Board;
  /**
   * Double-word squares, one in from each corner (shared/boards.ts). A
   * square pays out exactly once, to whichever play first covers it -- a
   * square already in `before` has already been paid, tile stacked on top
   * of it or not. A word that crosses two still doubles twice, the same way
   * two premium squares under one word always have in this kind of game.
   */
  bonusSquares?: ReadonlySet<string>;
}

export function scoreTurn(
  board: Board,
  placements: readonly Placement[],
  options: ScoreOptions = {},
): TurnScore {
  const before =
    options.before ??
    new Map([...board].filter(([key]) => !placements.some((p) => cellKey(p.x, p.y) === key)));

  const { runs, lone } = runsAndLoners(board, placements);

  /*
   * Every letter counts, a blank as much as any other.
   *
   * A blank used to score nothing, which made it a way to fill a square
   * cheaply rather than a letter you were glad to have. It pays now — the
   * restraint is that it cannot be the tile that closes a square.
   */
  const scoreCells = (cells: readonly Coord[]) =>
    cells.filter((c) => board.has(cellKey(c.x, c.y))).length;

  // A bonus square pays out on whichever play first covers it -- one that was
  // already sitting under a tile in `before` has already been spent, so only
  // a cell bonusSquares names *and* before doesn't have counts here.
  const bonusSquares = options.bonusSquares ?? new Set<string>();
  const freshBonusHits = (cells: readonly Coord[]) =>
    cells.filter((c) => bonusSquares.has(cellKey(c.x, c.y)) && !before.has(cellKey(c.x, c.y)))
      .length;

  // A long word pays only if it covers at least one square empty before the
  // turn: restacking letters inside a long word already on the board changes
  // it without making anything longer.
  const grew = (cells: readonly Coord[]) => cells.some((c) => !before.has(cellKey(c.x, c.y)));

  const scoredWord = (word: string, cells: readonly Coord[]): ScoredWord => {
    const hits = freshBonusHits(cells);
    const multiplier = 2 ** hits;
    const points = scoreCells(cells) * multiplier;
    const long = word.length >= LONG_WORD_MIN && grew(cells);
    return {
      word,
      points,
      ...(hits > 0 ? { bonus: multiplier } : {}),
      ...(long ? { long: true as const } : {}),
    };
  };

  const words: ScoredWord[] = runs.map((run) => scoredWord(run.word, run.cells));

  // A tile touching nothing forms no run. It still has to be a word in its own
  // right to be legal, so it scores as one.
  for (const p of lone) words.push(scoredWord(p.letter.toUpperCase(), [p]));

  const wordPoints = words.reduce((sum, w) => sum + w.points, 0);
  const blocks = newSquareBlocks(before, board, placements);
  const squares = blocks.map((block) => block.k);

  const squarePoints = blocks.length * SQUARE_BONUS;

  // Flat, once per qualifying word, and never touched by a bonus square's
  // multiplier -- it rewards the word's own length, not the ground it
  // happens to stand on.
  const longWordBonus = words.filter((w) => w.long).length * LONG_WORD_BONUS;

  return {
    wordPoints,
    words,
    squarePoints,
    squares,
    longWordBonus,
    total: wordPoints + squarePoints + longWordBonus,
  };
}
