import { describe, expect, test } from "vitest";
import { makeBoard, type TileSpec } from "./board.js";
import { scoreTurn, type Placement } from "./score.js";

const place = (specs: TileSpec[]): Placement[] =>
  specs.map(({ x, y, letter, isBlank }) => ({ x, y, letter, isBlank: isBlank ?? false }));

describe("scoreTurn", () => {
  test("scores every letter of the word formed", () => {
    const tiles: TileSpec[] = [
      { x: 0, y: 0, letter: "C" },
      { x: 1, y: 0, letter: "A" },
      { x: 2, y: 0, letter: "T" },
    ];

    expect(scoreTurn(makeBoard(tiles), place(tiles)).total).toBe(3);
  });

  test("a blank contributes no letter to the word", () => {
    const tiles: TileSpec[] = [
      { x: 0, y: 0, letter: "C" },
      { x: 1, y: 0, letter: "A", isBlank: true },
      { x: 2, y: 0, letter: "T" },
    ];

    expect(scoreTurn(makeBoard(tiles), place(tiles)).total).toBe(2);
  });

  test("a blank still counts toward the square it completes", () => {
    const tiles: TileSpec[] = [
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
      { x: 0, y: 1, letter: "T" },
      { x: 1, y: 1, letter: "O", isBlank: true },
    ];

    // Four words of 2 letters, but the blank counts in neither of the two it
    // sits in: 8 - 2 = 6, plus 2 for the 2x2.
    expect(scoreTurn(makeBoard(tiles), place(tiles)).total).toBe(8);
  });

  describe("spec payouts (design.md §4.2)", () => {
    const square = (n: number): TileSpec[] => {
      const out: TileSpec[] = [];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.push({ x, y, letter: "A" });
      return out;
    };

    const totalFor = (n: number) => {
      const tiles = square(n);
      return scoreTurn(makeBoard(tiles), place(tiles));
    };

    // An n x n block is 2n words of n letters, so n^2 * 2 word points.
    test("2x2 scores 10", () => {
      const s = totalFor(2);
      expect([s.wordPoints, s.squarePoints, s.total]).toEqual([8, 2, 10]);
    });

    test("3x3 scores 29", () => {
      const s = totalFor(3);
      expect([s.wordPoints, s.squarePoints, s.total]).toEqual([18, 11, 29]);
    });

    test("4x4 scores 66", () => {
      const s = totalFor(4);
      expect([s.wordPoints, s.squarePoints, s.total]).toEqual([32, 34, 66]);
    });
  });

  test("completing an opponent's 2x2 with one tile takes the lot (design.md §4.4)", () => {
    const board = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
      { x: 0, y: 1, letter: "T" },
      { x: 1, y: 1, letter: "O" },
    ]);

    // The one tile closes two 2-letter words and the square with them.
    const s = scoreTurn(board, place([{ x: 1, y: 1, letter: "O" }]));
    expect([s.wordPoints, s.squarePoints, s.total]).toEqual([4, 2, 6]);
  });
});

describe("words pay for letters already on the board", () => {
  test("one tile extending a word scores the whole word", () => {
    const board = makeBoard([
      { x: 0, y: 0, letter: "R" },
      { x: 1, y: 0, letter: "I" },
      { x: 2, y: 0, letter: "S" },
      { x: 3, y: 0, letter: "E" },
      { x: 4, y: 0, letter: "N" },
    ]);

    const s = scoreTurn(board, place([{ x: 4, y: 0, letter: "N" }]));
    expect(s.total).toBe(5);
    expect(s.words).toEqual([{ word: "RISEN", points: 5 }]);
  });

  test("so leaving a word extendable hands the next player its length", () => {
    // Placing AT and letting someone else add the E gives them more than
    // playing ATE outright would have given you.
    const atOnce = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
      { x: 2, y: 0, letter: "E" },
    ]);
    const mine = scoreTurn(atOnce, place([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
      { x: 2, y: 0, letter: "E" },
    ]));

    const theirs = scoreTurn(atOnce, place([{ x: 2, y: 0, letter: "E" }]));

    expect(mine.total).toBe(3);
    expect(theirs.total).toBe(3);
  });
});

describe("laying a tile on top of another", () => {
  const at = (x: number, y: number, letter: string) => ({ x, y, letter, isBlank: false });

  test("the new word scores in full, letters underneath included", () => {
    // CAT was there; playing O over the A makes COT.
    const before = makeBoard([at(7, 7, "C"), at(8, 7, "A"), at(9, 7, "T")]);
    const after = makeBoard([at(7, 7, "C"), at(8, 7, "O"), at(9, 7, "T")]);

    const score = scoreTurn(after, [at(8, 7, "O")], { before });

    expect(score.words).toEqual([{ word: "COT", points: 3 }]);
    expect(score.total).toBe(3);
  });

  test("but the square it sits in pays nothing if it was already complete", () => {
    const square = [at(0, 0, "A"), at(1, 0, "T"), at(0, 1, "T"), at(1, 1, "O")];
    const before = makeBoard(square);
    const after = makeBoard([...square, at(0, 0, "I")]);

    const score = scoreTurn(after, [at(0, 0, "I")], { before });

    expect(score.squares).toEqual([]);
    expect(score.squarePoints).toBe(0);
    // The words it changed still pay: IT down and IT across.
    expect(score.wordPoints).toBe(4);
  });
});
