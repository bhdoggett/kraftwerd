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
  test("a freshly placed 2x2 yields nothing", () => {
    const tiles = block(0, 0, 2, 2);

    expect(sizes(makeBoard(tiles), coords(tiles))).toEqual([]);
  });

  test("a 3x3 yields itself only, not its 2x2 sub-squares", () => {
    const tiles = block(0, 0, 3, 3);

    expect(sizes(makeBoard(tiles), coords(tiles))).toEqual([3]);
  });

  test("a 4x4 yields four 3x3 and one 4x4, no 2x2s", () => {
    const tiles = block(0, 0, 4, 4);
    const result = sizes(makeBoard(tiles), coords(tiles));

    expect(result.filter((k) => k === 2)).toHaveLength(0);
    expect(result.filter((k) => k === 3)).toHaveLength(4);
    expect(result.filter((k) => k === 4)).toHaveLength(1);
  });

  test("one tile completing a 2x2 scores nothing", () => {
    const board = makeBoard([...block(0, 0, 2, 2)]);

    // three tiles were already there; only (1,1) is new
    expect(sizes(board, [{ x: 1, y: 1 }])).toEqual([]);
  });

  test("an already-complete square does not score again", () => {
    // A complete 3x3 on the left; two of the three cells a second 3x3 to its
    // right needs are already there too.
    const board = makeBoard([
      ...block(0, 0, 3, 3),
      { x: 3, y: 0, letter: "A" },
      { x: 3, y: 1, letter: "A" },
      { x: 3, y: 2, letter: "A" },
    ]);

    expect(sizes(board, [{ x: 3, y: 2 }])).toEqual([3]);
  });

  test("a placement that completes nothing scores no squares", () => {
    const board = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
      { x: 0, y: 1, letter: "T" },
    ]);

    expect(sizes(board, [{ x: 0, y: 1 }])).toEqual([]);
  });

  test("a diagonal placement no longer completes anything at 2x2", () => {
    //  X X .        (1,1) fills the shared corner of the top-left
    //  X ? X        and bottom-right blocks -- both are 2x2s, and
    //  . X X        neither pays any more.
    const board = makeBoard([
      ...block(0, 0, 2, 1),
      { x: 0, y: 1, letter: "A" },
      { x: 1, y: 1, letter: "A" },
      { x: 2, y: 1, letter: "A" },
      { x: 1, y: 2, letter: "A" },
      { x: 2, y: 2, letter: "A" },
    ]);

    expect(sizes(board, [{ x: 1, y: 1 }])).toEqual([]);
  });
});

describe("squares when tiles land on top of tiles", () => {
  test("replacing a tile inside a finished square scores nothing", () => {
    // A 3x3 that was already complete before this turn.
    const before = makeBoard(block(0, 0, 3, 3));
    const after = makeBoard([
      ...block(0, 0, 3, 3).filter((t) => !(t.x === 1 && t.y === 1)),
      { x: 1, y: 1, letter: "B" },
    ]);

    expect(newSquares(before, after, [{ x: 1, y: 1 }])).toEqual([]);
  });

  test("a square finished this turn still scores", () => {
    const before = makeBoard(
      block(0, 0, 3, 3).filter((t) => !(t.x === 2 && t.y === 2)),
    );
    const after = makeBoard(block(0, 0, 3, 3));

    expect(newSquares(before, after, [{ x: 2, y: 2 }])).toEqual([3]);
  });

  test("a replacement that completes a different square scores that one", () => {
    // The left 3x3 is done; two of the three cells a second one to its right
    // needs are already there. This turn overwrites the middle of the
    // finished square and finishes the new one at the same time -- only the
    // new one pays.
    const before = makeBoard([
      ...block(0, 0, 3, 3),
      { x: 3, y: 0, letter: "A" },
      { x: 3, y: 1, letter: "A" },
    ]);
    const after = makeBoard([
      ...block(0, 0, 3, 3).filter((t) => !(t.x === 1 && t.y === 1)),
      { x: 1, y: 1, letter: "C" },
      { x: 3, y: 0, letter: "A" },
      { x: 3, y: 1, letter: "A" },
      { x: 3, y: 2, letter: "A" },
    ]);

    expect(
      newSquares(before, after, [
        { x: 1, y: 1 },
        { x: 3, y: 2 },
      ]),
    ).toEqual([3]);
  });
});
