import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { makeBoard, type Board } from "../engine/board";
import { makeDictionary } from "../engine/dictionary";
import { applyPlacements, validateTurn } from "../engine/legality";
import { scoreTurn } from "../engine/score";
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

  test("depth 1 is exactly the single-span search", () => {
    const one = chained(board, ["S", "O", "T", "A"], 1);
    expect(one.every((m) => {
      const rows = new Set(m.placements.map((p) => p.y));
      const cols = new Set(m.placements.map((p) => p.x));
      return rows.size === 1 || cols.size === 1;
    })).toBe(true);
  });
});
