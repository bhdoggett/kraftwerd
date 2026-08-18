import { describe, expect, test } from "vitest";
import { makeBoard, type TileSpec } from "./board.js";
import { scoreTurn, type Placement } from "./score.js";

const place = (specs: TileSpec[]): Placement[] =>
  specs.map(({ x, y, letter, isBlank }) => ({ x, y, letter, isBlank: isBlank ?? false }));

describe("scoreTurn", () => {
  test("scores one point per placed tile", () => {
    const tiles: TileSpec[] = [
      { x: 0, y: 0, letter: "C" },
      { x: 1, y: 0, letter: "A" },
      { x: 2, y: 0, letter: "T" },
    ];

    expect(scoreTurn(makeBoard(tiles), place(tiles)).total).toBe(3);
  });

  test("a blank earns no tile point", () => {
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

    // 3 tile points (blank scores 0) + 4 for the 2x2
    expect(scoreTurn(makeBoard(tiles), place(tiles)).total).toBe(7);
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

    test("2x2 scores 8", () => {
      const s = totalFor(2);
      expect([s.tilePoints, s.squarePoints, s.total]).toEqual([4, 4, 8]);
    });

    test("3x3 scores 34", () => {
      const s = totalFor(3);
      expect([s.tilePoints, s.squarePoints, s.total]).toEqual([9, 25, 34]);
    });

    test("4x4 scores 104", () => {
      const s = totalFor(4);
      expect([s.tilePoints, s.squarePoints, s.total]).toEqual([16, 88, 104]);
    });
  });

  test("completing an opponent's 2x2 with one tile scores 5 (design.md §4.4)", () => {
    const board = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
      { x: 0, y: 1, letter: "T" },
      { x: 1, y: 1, letter: "O" },
    ]);

    const s = scoreTurn(board, place([{ x: 1, y: 1, letter: "O" }]));
    expect([s.tilePoints, s.squarePoints, s.total]).toEqual([1, 4, 5]);
  });
});
