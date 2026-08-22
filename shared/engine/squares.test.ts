import { describe, expect, test } from "vitest";
import { makeBoard, type TileSpec } from "./board.js";
import { newSquares } from "./squares.js";

/** Every cell of an w x h block anchored at (ox, oy), filled with "A". */
const block = (ox: number, oy: number, w: number, h: number): TileSpec[] => {
  const out: TileSpec[] = [];
  for (let y = oy; y < oy + h; y++) {
    for (let x = ox; x < ox + w; x++) out.push({ x, y, letter: "A" });
  }
  return out;
};

const coords = (specs: TileSpec[]) => specs.map(({ x, y }) => ({ x, y }));

/** Scores `placed` as a turn on `board`, which is the board after the turn. */
const sizes = (board: Parameters<typeof newSquares>[0], placed: { x: number; y: number }[]) => {
  const before = new Map(
    [...board].filter(([key]) => !placed.some((p) => `${p.x},${p.y}` === key)),
  );
  return newSquares(before, board, placed).sort();
};

describe("newSquares", () => {
  test("a freshly placed 2x2 yields one square of size 2", () => {
    const tiles = block(0, 0, 2, 2);

    expect(sizes(makeBoard(tiles), coords(tiles))).toEqual([2]);
  });

  test("a 3x3 yields its four 2x2 sub-squares plus itself", () => {
    const tiles = block(0, 0, 3, 3);

    expect(sizes(makeBoard(tiles), coords(tiles))).toEqual([2, 2, 2, 2, 3]);
  });

  test("a 4x4 yields nine 2x2, four 3x3 and one 4x4", () => {
    const tiles = block(0, 0, 4, 4);
    const result = sizes(makeBoard(tiles), coords(tiles));

    expect(result.filter((k) => k === 2)).toHaveLength(9);
    expect(result.filter((k) => k === 3)).toHaveLength(4);
    expect(result.filter((k) => k === 4)).toHaveLength(1);
  });

  test("one tile completing a 2x2 scores the whole square", () => {
    const board = makeBoard([...block(0, 0, 2, 2)]);

    // three tiles were already there; only (1,1) is new
    expect(sizes(board, [{ x: 1, y: 1 }])).toEqual([2]);
  });

  test("an already-complete square does not score again", () => {
    // existing 2x2 at (0,0); this turn adds the column at x=2, making a 2x3.
    const board = makeBoard(block(0, 0, 3, 2));

    expect(sizes(board, [
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ])).toEqual([2]);
  });

  test("a placement that completes nothing scores no squares", () => {
    const board = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
      { x: 0, y: 1, letter: "T" },
    ]);

    expect(sizes(board, [{ x: 0, y: 1 }])).toEqual([]);
  });

  test("a diagonal placement completes two separate 2x2 blocks", () => {
    //  X X .        (1,1) fills the shared corner of the top-left
    //  X ? X        and bottom-right blocks
    //  . X X
    const board = makeBoard([
      ...block(0, 0, 2, 1),
      { x: 0, y: 1, letter: "A" },
      { x: 1, y: 1, letter: "A" },
      { x: 2, y: 1, letter: "A" },
      { x: 1, y: 2, letter: "A" },
      { x: 2, y: 2, letter: "A" },
    ]);

    expect(sizes(board, [{ x: 1, y: 1 }])).toEqual([2, 2]);
  });
});

describe("squares when tiles land on top of tiles", () => {
  const filled = (x: number, y: number, letter = "A") => ({ x, y, letter });

  test("replacing a tile inside a finished square scores nothing", () => {
    // A 2x2 that was already complete before this turn.
    const before = makeBoard([filled(0, 0), filled(1, 0), filled(0, 1), filled(1, 1)]);
    const after = makeBoard([filled(0, 0, "B"), filled(1, 0), filled(0, 1), filled(1, 1)]);

    expect(newSquares(before, after, [{ x: 0, y: 0 }])).toEqual([]);
  });

  test("a square finished this turn still scores", () => {
    const before = makeBoard([filled(0, 0), filled(1, 0), filled(0, 1)]);
    const after = makeBoard([filled(0, 0), filled(1, 0), filled(0, 1), filled(1, 1)]);

    expect(newSquares(before, after, [{ x: 1, y: 1 }])).toEqual([2]);
  });

  test("a replacement that completes a different square scores that one", () => {
    // The left 2x2 is done; laying a tile at (2,0) and (2,1) closes a new one
    // to its right, and overwriting (1,1) at the same time pays only for the
    // square that was not there before.
    const before = makeBoard([
      filled(0, 0), filled(1, 0), filled(0, 1), filled(1, 1),
    ]);
    const after = makeBoard([
      filled(0, 0), filled(1, 0), filled(0, 1), filled(1, 1, "C"),
      filled(2, 0), filled(2, 1),
    ]);

    expect(newSquares(before, after, [{ x: 1, y: 1 }, { x: 2, y: 0 }, { x: 2, y: 1 }])).toEqual([2]);
  });
});
