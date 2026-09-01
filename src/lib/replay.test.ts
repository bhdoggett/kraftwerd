import { describe, expect, test } from "vitest";
import { boardAfter, scoresAfter } from "./replay";

const play = (userId: string, ...cells: [number, number, string][]) => ({
  userId,
  kind: "play" as const,
  score: cells.length,
  placements: cells.map(([x, y, letter]) => ({ x, y, letter, isBlank: false })),
});

const scored = (userId: string, score: number) => ({
  userId,
  kind: "play" as const,
  score,
  placements: [],
});

const at = (tiles: ReturnType<typeof boardAfter>, x: number, y: number) =>
  tiles.find((t) => t.x === x && t.y === y);

describe("the board as it stood", () => {
  const turns = [
    play("alice", [0, 0, "C"], [1, 0, "A"], [2, 0, "T"]),
    play("bob", [1, 0, "O"]),
  ];

  test("before anything was played it is empty", () => {
    expect(boardAfter(turns, 0)).toEqual([]);
  });

  test("one turn in, only that turn is on it", () => {
    const tiles = boardAfter(turns, 1);
    expect(tiles.map((t) => t.letter).join("")).toBe("CAT");
    expect(tiles.every((t) => t.placedBy === "alice")).toBe(true);
  });

  test("a tile played over another takes the square", () => {
    const tiles = boardAfter(turns, 2);

    // The square keeps one tile, not two: the letter on top is the letter
    // that reads, and it belongs to whoever laid it.
    expect(tiles).toHaveLength(3);
    expect(at(tiles, 1, 0)).toMatchObject({ letter: "O", placedBy: "bob", stacked: 2 });
    expect(at(tiles, 0, 0)).toMatchObject({ letter: "C", stacked: 1 });
  });

  test("asking past the end gives the board as it stands now", () => {
    expect(boardAfter(turns, 99)).toEqual(boardAfter(turns, 2));
  });

  test("a turn that placed nothing changes nothing", () => {
    const withPass = [
      ...turns,
      { userId: "alice", kind: "pass" as const, score: 0, placements: [] },
    ];
    expect(boardAfter(withPass, 3)).toEqual(boardAfter(turns, 2));
  });
});

describe("the scores as they stood", () => {
  const turns = [
    scored("alice", 12),
    scored("bob", 7),
    scored("alice", 30),
    scored("bob", 4),
  ];

  test("nobody has scored before the first turn", () => {
    expect(scoresAfter(turns, 0)).toEqual(new Map());
  });

  test("counts up as the turns go by", () => {
    expect(scoresAfter(turns, 1)).toEqual(new Map([["alice", 12]]));
    expect(scoresAfter(turns, 2)).toEqual(
      new Map([
        ["alice", 12],
        ["bob", 7],
      ]),
    );
  });

  test("every turn played is every turn counted", () => {
    expect(scoresAfter(turns, turns.length)).toEqual(
      new Map([
        ["alice", 42],
        ["bob", 11],
      ]),
    );
  });

  test("a pass adds nothing but does not lose what came before", () => {
    const passed = [scored("alice", 12), { ...scored("alice", 0), kind: "pass" as const, score: 0 }];

    expect(scoresAfter(passed, 2)).toEqual(new Map([["alice", 12]]));
  });
});
