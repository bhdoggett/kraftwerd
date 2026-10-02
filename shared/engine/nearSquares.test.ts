import { describe, expect, test } from "vitest";
import { makeBoard } from "./board";
import { nearSquares } from "./nearSquares";

const at = (x: number, y: number, letter = "A") => ({ x, y, letter, isBlank: false });
const open = { blocked: new Set<string>() };

// Seven of a 3x3's nine squares at (6,6): all but (6,8) and (8,8).
const seven = () =>
  makeBoard([[6, 6], [7, 6], [8, 6], [6, 7], [7, 7], [8, 7], [7, 8]].map(([x, y]) => at(x, y)));

describe("nearSquares", () => {
  test("a move that leaves one gap reports the block and the gap", () => {
    expect(nearSquares(seven(), [at(6, 8)], open, 15)).toEqual([
      { x: 6, y: 6, gap: { x: 8, y: 8 } },
    ]);
  });

  test("closing the block leaves nothing", () => {
    const eight = new Map(seven());
    eight.set("6,8", { letter: "A", isBlank: false, stacked: 1 });
    expect(nearSquares(eight, [at(8, 8)], open, 15)).toEqual([]);
  });

  test("a block with a blocked square in it can never close", () => {
    const blocked = { blocked: new Set(["8,8"]) };
    expect(nearSquares(seven(), [at(6, 8)], blocked, 15)).toEqual([]);
  });

  test("a 2x2 one short is not a 3x3", () => {
    const board = makeBoard([at(7, 7), at(8, 7)]);
    expect(nearSquares(board, [at(7, 8)], open, 15)).toEqual([]);
  });

  test("blocks off the edge of the board are not counted", () => {
    const board = makeBoard([at(0, 0), at(1, 0), at(2, 0), at(0, 1), at(1, 1), at(2, 1), at(1, 2)]);
    expect(nearSquares(board, [at(0, 2)], open, 15)).toEqual([
      { x: 0, y: 0, gap: { x: 2, y: 2 } },
    ]);
  });
});
