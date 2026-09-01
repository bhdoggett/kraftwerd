import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { makeBoard, type Board } from "../engine/board";
import { makeDictionary } from "../engine/dictionary";
import { applyPlacements, validateTurn } from "../engine/legality";
import { scoreTurn, type Placement } from "../engine/score";
import { newSquares } from "../engine/squares";
import { indexWords } from "./words";
import { chain } from "./chain";

const WORDS = ["AT", "TO", "ON", "NO", "AN", "IT", "IS", "SO", "OX", "AX",
  "CAT", "CATS", "OAT", "OATS", "TON", "NOT", "SAT", "SIT", "TIN", "NIT"];
const dictionary = makeDictionary(WORDS);
const words = indexWords(WORDS, 7);
const shape = boardShapeNamed(OPEN_BOARD, 15);
const bounds = { width: 15, height: 15, blocked: shape.blocked, centre: shape.centre };

const chained = (board: Board, letters: string[], depth = 2, breadth = 6) =>
  chain(board, { letters, blanks: 0 }, dictionary, words, shape, 15,
    (after, p, before) => scoreTurn(after, p, { before }).total,
    { depth, breadth });

describe("chaining", () => {
  /** CAT across the middle: room to play on either side of it. */
  const board = makeBoard([..."CAT"].map((letter, i) => ({
    x: 6 + i, y: 7, letter, isBlank: false, stacked: 1,
  })));

  test("offers turns that touch the board in more than one place", () => {
    const moves = chained(board, ["S", "O", "T", "A", "N"]);

    const spread = moves.filter((m) => {
      const rows = new Set(m.placements.map((p) => p.y));
      const cols = new Set(m.placements.map((p) => p.x));
      // Neither a single row nor a single column: not one span.
      return rows.size > 1 && cols.size > 1;
    });

    expect(spread.length).toBeGreaterThan(0);
  });

  test("every chained turn is legal as a whole", () => {
    for (const move of chained(board, ["S", "O", "T", "A", "N"])) {
      expect(validateTurn(board, move.placements, dictionary, bounds)).toEqual({ ok: true });
    }
  });

  test("scores the whole turn at once, against the board it started from", () => {
    for (const move of chained(board, ["S", "O", "T", "A", "N"])) {
      const after = applyPlacements(board, move.placements);
      expect(move.score).toBe(scoreTurn(after, move.placements, { before: board }).total);
    }
  });

  test("never spends a letter it does not hold", () => {
    for (const move of chained(board, ["S", "O", "T"])) {
      const spent = move.placements.filter((p) => !p.isBlank).map((p) => p.letter).sort();
      const held = ["O", "S", "T"];
      for (const letter of new Set(spent)) {
        expect(spent.filter((l) => l === letter).length)
          .toBeLessThanOrEqual(held.filter((l) => l === letter).length);
      }
    }
  });

  test("offers no duplicates", () => {
    const moves = chained(board, ["S", "O", "T", "A"]);
    const keys = moves.map((m) => JSON.stringify(
      [...m.placements].sort((a, b) => a.x - b.x || a.y - b.y)));
    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * Breadth limits what is built on, not what is offered.
   *
   * Difficulty reads this list as fractions of the best score, so a list cut
   * back to the few strongest moves and their extensions leaves an easy player
   * nothing weak to choose.
   */
  test("keeps every single-span move, not just the ones worth building on", () => {
    const singles = chained(board, ["S", "O", "T", "A", "N"], 1);
    const keys = new Set(chained(board, ["S", "O", "T", "A", "N"], 2, 1).map((m) =>
      JSON.stringify([...m.placements].sort((a, b) => a.x - b.x || a.y - b.y))));

    for (const single of singles) {
      expect(keys).toContain(
        JSON.stringify([...single.placements].sort((a, b) => a.x - b.x || a.y - b.y)));
    }
  });

  test("depth 1 is exactly the single-span search", () => {
    const one = chained(board, ["S", "O", "T", "A"], 1);
    expect(one.every((m) => {
      const rows = new Set(m.placements.map((p) => p.y));
      const cols = new Set(m.placements.map((p) => p.x));
      return rows.size === 1 || cols.size === 1;
    })).toBe(true);
  });
});

/** Every non-empty selection of `placements` bar the whole of it. */
function* properSubsets(placements: readonly Placement[]): Generator<Placement[]> {
  for (let mask = 1; mask < (1 << placements.length) - 1; mask++) {
    yield placements.filter((_, i) => (mask & (1 << i)) !== 0);
  }
}

/**
 * The point of the whole exercise: square bonuses compound.
 *
 * Two plays that separately complete nothing can together complete a k x k,
 * and it is only worth chaining them if that k^2 is actually collected. That
 * turns on scoring the accumulated turn once against the board it began on --
 * score each link against the link before it and the square falls between the
 * two, belonging to neither.
 */
describe("chaining into a square", () => {
  /*
   * ON already down along the bottom. Three tiles finish the 2x2 at columns
   * 7-8, rows 7-8 -- but they make an L, so no straight line holds them and no
   * single play lays them. AN across row 7 leaves the square a corner short;
   * TON along row 8 leaves it two corners short.
   *
   *        7    8    9
   *   7    A    N    .
   *   8    T   [O]  [N]
   */
  const board = makeBoard([
    { x: 8, y: 8, letter: "O", isBlank: false, stacked: 1 },
    { x: 9, y: 8, letter: "N", isBlank: false, stacked: 1 },
  ]);

  test("collects a square no part of the turn could have closed", () => {
    const closing = chained(board, ["A", "N", "T"]).filter((move) =>
      newSquares(board, applyPlacements(board, move.placements), move.placements).includes(2),
    );

    expect(closing.length).toBeGreaterThan(0);

    for (const move of closing) {
      // An L, not a line: this turn is not reachable as a single play.
      expect(new Set(move.placements.map((p) => p.x)).size).toBeGreaterThan(1);
      expect(new Set(move.placements.map((p) => p.y)).size).toBeGreaterThan(1);

      // Nor as a play that happened to close it and a play that tidied up:
      // no part of the turn closes anything on its own.
      for (const part of properSubsets(move.placements)) {
        expect(newSquares(board, applyPlacements(board, part), part)).toEqual([]);
      }

      // And the four points are in the score, not merely in the geometry.
      const scored = scoreTurn(applyPlacements(board, move.placements), move.placements, {
        before: board,
      });
      expect(scored.squarePoints).toBe(4);
      expect(move.score).toBe(scored.total);
      expect(move.score).toBeGreaterThan(scored.wordPoints);
    }
  });
});
