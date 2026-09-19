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

  test("a blank counts as a letter like any other", () => {
    const tiles: TileSpec[] = [
      { x: 0, y: 0, letter: "C" },
      { x: 1, y: 0, letter: "A", isBlank: true },
      { x: 2, y: 0, letter: "T" },
    ];

    expect(scoreTurn(makeBoard(tiles), place(tiles)).total).toBe(3);
  });

  test("a blank still counts toward the square it completes", () => {
    const tiles: TileSpec[] = [
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
      { x: 0, y: 1, letter: "T" },
      { x: 1, y: 1, letter: "O", isBlank: true },
    ];

    // Four words of 2 letters, the blank paying its way in both it sits in:
    // 8. The 2x2 it completes pays nothing.
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
    // Only a 3x3 pays a square bonus, flat at SQUARE_BONUS, and a bigger
    // block pays once for each 3x3 nested inside it.
    test("2x2 scores nothing beyond its words", () => {
      const s = totalFor(2);
      expect([s.wordPoints, s.squarePoints, s.total]).toEqual([8, 0, 8]);
    });

    test("3x3 scores 51", () => {
      const s = totalFor(3);
      expect([s.wordPoints, s.squarePoints, s.total]).toEqual([18, 33, 51]);
    });

    test("4x4 scores its four nested 3x3s, nothing for itself", () => {
      const s = totalFor(4);
      expect([s.wordPoints, s.squarePoints, s.total]).toEqual([32, 132, 164]);
    });
  });

  test("completing a 2x2 with one tile scores only the words (design.md §4.4)", () => {
    const board = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
      { x: 0, y: 1, letter: "T" },
      { x: 1, y: 1, letter: "O" },
    ]);

    // The one tile closes two 2-letter words; the square they complete pays
    // nothing.
    const s = scoreTurn(board, place([{ x: 1, y: 1, letter: "O" }]));
    expect([s.wordPoints, s.squarePoints, s.total]).toEqual([4, 0, 4]);
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
    // 5 word points, plus the flat long-word bonus RISEN's five letters earn.
    expect(s.total).toBe(10);
    expect(s.words).toEqual([{ word: "RISEN", points: 5 }]);
    expect(s.longWordBonus).toBe(5);
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
    // Landing on the occupied square also pays the stack bonus (2).
    expect(score.stackBonus).toBe(2);
    expect(score.total).toBe(5);
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

describe("rack bonus", () => {
  test("clearing the whole rack pays 5 on top (design.md §4.7)", () => {
    const tiles: TileSpec[] = [
      { x: 0, y: 0, letter: "C" },
      { x: 1, y: 0, letter: "A" },
      { x: 2, y: 0, letter: "T" },
    ];

    const s = scoreTurn(makeBoard(tiles), place(tiles), { rackCleared: true });
    expect(s.rackBonus).toBe(5);
    expect(s.total).toBe(3 + 5);
  });

  test("not clearing the rack pays no bonus", () => {
    const tiles: TileSpec[] = [
      { x: 0, y: 0, letter: "C" },
      { x: 1, y: 0, letter: "A" },
      { x: 2, y: 0, letter: "T" },
    ];

    expect(scoreTurn(makeBoard(tiles), place(tiles)).rackBonus).toBe(0);
    expect(scoreTurn(makeBoard(tiles), place(tiles), { rackCleared: false }).rackBonus).toBe(0);
  });
});

describe("long word bonus", () => {
  test("a word under five letters pays no long-word bonus", () => {
    const tiles: TileSpec[] = [
      { x: 0, y: 0, letter: "C" },
      { x: 1, y: 0, letter: "A" },
      { x: 2, y: 0, letter: "N" },
      { x: 3, y: 0, letter: "E" },
    ];

    const s = scoreTurn(makeBoard(tiles), place(tiles));
    expect(s.longWordBonus).toBe(0);
    expect(s.total).toBe(4);
  });

  test("a word of five letters or more pays a flat bonus on top (design.md §4.1)", () => {
    const tiles: TileSpec[] = [
      { x: 0, y: 0, letter: "C" },
      { x: 1, y: 0, letter: "R" },
      { x: 2, y: 0, letter: "A" },
      { x: 3, y: 0, letter: "N" },
      { x: 4, y: 0, letter: "E" },
    ];

    const s = scoreTurn(makeBoard(tiles), place(tiles));
    expect(s.longWordBonus).toBe(5);
    expect(s.total).toBe(5 + 5);
  });

  test("two qualifying words in the same turn each pay the bonus", () => {
    const tiles: TileSpec[] = [
      // PLANE, five letters
      { x: 0, y: 0, letter: "P" },
      { x: 1, y: 0, letter: "L" },
      { x: 2, y: 0, letter: "A" },
      { x: 3, y: 0, letter: "N" },
      { x: 4, y: 0, letter: "E" },
      // GRAPES, six letters, unconnected -- scoreTurn does not police
      // connectivity, only validateTurn does
      { x: 0, y: 5, letter: "G" },
      { x: 1, y: 5, letter: "R" },
      { x: 2, y: 5, letter: "A" },
      { x: 3, y: 5, letter: "P" },
      { x: 4, y: 5, letter: "E" },
      { x: 5, y: 5, letter: "S" },
    ];

    const s = scoreTurn(makeBoard(tiles), place(tiles));
    expect(s.longWordBonus).toBe(10);
  });

  test("the long-word bonus is flat, never doubled by a bonus square", () => {
    const tiles: TileSpec[] = [
      { x: 0, y: 0, letter: "C" },
      { x: 1, y: 0, letter: "R" },
      { x: 2, y: 0, letter: "A" },
      { x: 3, y: 0, letter: "N" },
      { x: 4, y: 0, letter: "E" },
    ];
    const bonusSquares = new Set(["2,0"]);

    const s = scoreTurn(makeBoard(tiles), place(tiles), {
      before: makeBoard([]),
      bonusSquares,
    });

    // Word points double (5 * 2 = 10); the long-word bonus stays flat.
    expect(s.words).toEqual([{ word: "CRANE", points: 10, bonus: 2 }]);
    expect(s.longWordBonus).toBe(5);
    expect(s.total).toBe(10 + 5);
  });
});

describe("stack bonus", () => {
  const at = (x: number, y: number, letter: string) => ({ x, y, letter, isBlank: false });

  test("a tile on an empty square pays no stack bonus", () => {
    const before = makeBoard([]);
    const after = makeBoard([at(0, 0, "A")]);

    expect(scoreTurn(after, [at(0, 0, "A")], { before }).stackBonus).toBe(0);
  });

  test("the first tile stacked on a square pays 2", () => {
    const before = makeBoard([at(0, 0, "A")]);
    const after = makeBoard([at(0, 0, "I")]);

    expect(scoreTurn(after, [at(0, 0, "I")], { before }).stackBonus).toBe(2);
  });

  test("the second tile stacked on a square pays 3", () => {
    const before = makeBoard([{ x: 0, y: 0, letter: "I", stacked: 2 }]);
    const after = makeBoard([at(0, 0, "A")]);

    expect(scoreTurn(after, [at(0, 0, "A")], { before }).stackBonus).toBe(3);
  });
});

describe("bonus squares", () => {
  const at = (x: number, y: number, letter: string) => ({ x, y, letter, isBlank: false });

  test("a word crossing a fresh bonus square doubles", () => {
    const tiles = [at(0, 0, "C"), at(1, 0, "A"), at(2, 0, "T")];
    const bonusSquares = new Set(["1,0"]);

    const score = scoreTurn(makeBoard(tiles), place(tiles), {
      before: makeBoard([]),
      bonusSquares,
    });

    expect(score.words).toEqual([{ word: "CAT", points: 6, bonus: 2 }]);
    expect(score.total).toBe(6);
  });

  test("a word nowhere near a bonus square scores normally", () => {
    const tiles = [at(0, 0, "C"), at(1, 0, "A"), at(2, 0, "T")];
    const bonusSquares = new Set(["7,7"]);

    const score = scoreTurn(makeBoard(tiles), place(tiles), {
      before: makeBoard([]),
      bonusSquares,
    });

    expect(score.words).toEqual([{ word: "CAT", points: 3 }]);
  });

  test("single-use: a square already covered in `before` has already been spent", () => {
    // The bonus square (1,0) was covered on an earlier turn -- extending the
    // word now must not pay it out a second time.
    const before = makeBoard([at(0, 0, "C"), at(1, 0, "A")]);
    const tiles = [at(0, 0, "C"), at(1, 0, "A"), at(2, 0, "T")];
    const bonusSquares = new Set(["1,0"]);

    const score = scoreTurn(makeBoard(tiles), [at(2, 0, "T")], { before, bonusSquares });

    expect(score.words).toEqual([{ word: "CAT", points: 3 }]);
  });

  test("two words crossing the same fresh square in one play both double", () => {
    // CAT across, ARC down, sharing the A at (1,0) -- a bonus square there
    // pays out on both words this play forms.
    const tiles = [
      at(0, 0, "C"),
      at(1, 0, "A"),
      at(2, 0, "T"),
      at(1, 1, "R"),
      at(1, 2, "C"),
    ];
    const bonusSquares = new Set(["1,0"]);

    const score = scoreTurn(makeBoard(tiles), place(tiles), {
      before: makeBoard([]),
      bonusSquares,
    });

    expect(score.words).toEqual(
      expect.arrayContaining([
        { word: "CAT", points: 6, bonus: 2 },
        { word: "ARC", points: 6, bonus: 2 },
      ]),
    );
  });

  test("a word crossing two fresh bonus squares in one play quadruples", () => {
    const tiles = [at(0, 0, "C"), at(1, 0, "A"), at(2, 0, "T")];
    const bonusSquares = new Set(["0,0", "2,0"]);

    const score = scoreTurn(makeBoard(tiles), place(tiles), {
      before: makeBoard([]),
      bonusSquares,
    });

    expect(score.words).toEqual([{ word: "CAT", points: 12, bonus: 4 }]);
  });

  test("with no bonus squares configured, nothing doubles", () => {
    const tiles = [at(0, 0, "C"), at(1, 0, "A"), at(2, 0, "T")];

    const score = scoreTurn(makeBoard(tiles), place(tiles), { before: makeBoard([]) });

    expect(score.words).toEqual([{ word: "CAT", points: 3 }]);
  });
});
