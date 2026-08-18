import { describe, expect, test } from "vitest";
import { makeBoard } from "./board.js";
import { runsThrough } from "./runs.js";

const words = (board: Parameters<typeof runsThrough>[0], placed: { x: number; y: number }[]) =>
  runsThrough(board, placed)
    .map((r) => r.word)
    .sort();

describe("runsThrough", () => {
  test("finds a horizontal run through the placed tiles", () => {
    const board = makeBoard([
      { x: 0, y: 0, letter: "C" },
      { x: 1, y: 0, letter: "A" },
      { x: 2, y: 0, letter: "T" },
    ]);

    expect(words(board, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ])).toEqual(["CAT"]);
  });

  test("finds a vertical run through the placed tiles", () => {
    const board = makeBoard([
      { x: 0, y: 0, letter: "C" },
      { x: 0, y: 1, letter: "A" },
      { x: 0, y: 2, letter: "T" },
    ]);

    expect(words(board, [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
    ])).toEqual(["CAT"]);
  });

  test("ignores a lone tile with no neighbours", () => {
    const board = makeBoard([{ x: 5, y: 5, letter: "Q" }]);

    expect(words(board, [{ x: 5, y: 5 }])).toEqual([]);
  });

  test("reports both the across and the down word for a crossing tile", () => {
    // A T   placing T at (1,0) makes AT across and TO down
    //   O
    const board = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
      { x: 1, y: 1, letter: "O" },
    ]);

    expect(words(board, [{ x: 1, y: 0 }])).toEqual(["AT", "TO"]);
  });

  test("reports all four runs of a 2x2 block", () => {
    // A T
    // T O
    const board = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
      { x: 0, y: 1, letter: "T" },
      { x: 1, y: 1, letter: "O" },
    ]);

    const placed = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];

    expect(words(board, placed)).toEqual(["AT", "AT", "TO", "TO"]);
  });

  test("includes pre-existing tiles that the placement extends", () => {
    const board = makeBoard([
      { x: 0, y: 0, letter: "C" },
      { x: 1, y: 0, letter: "A" },
      { x: 2, y: 0, letter: "T" },
      { x: 3, y: 0, letter: "S" },
    ]);

    // only S is newly placed; the run still reads CATS
    expect(words(board, [{ x: 3, y: 0 }])).toEqual(["CATS"]);
  });

  test("does not report a run twice when two placed tiles share it", () => {
    const board = makeBoard([
      { x: 0, y: 0, letter: "T" },
      { x: 1, y: 0, letter: "O" },
    ]);

    expect(words(board, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ])).toEqual(["TO"]);
  });
});
