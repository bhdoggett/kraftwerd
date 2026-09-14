import { describe, expect, test } from "vitest";
import {
  latestPlayByOthers,
  playsInHistorySinceYourTurn,
  playsSinceYourTurn,
} from "./recap";

const tile = (x: number, y: number, placedBy: string, turnNumber: number) => ({
  x,
  y,
  placedBy,
  turnNumber,
});

const play = (turnNumber: number, cells: string[]) => ({
  turnNumber,
  cells: new Set(cells),
});

describe("what changed while you were gone", () => {
  test("an empty board has nothing to point out", () => {
    expect(playsSinceYourTurn([], "you")).toEqual([]);
  });

  test("each play since your last turn, oldest first, at a table of three", () => {
    const board = [
      tile(0, 0, "you", 1),
      tile(1, 0, "you", 4),
      tile(2, 0, "ann", 5),
      tile(3, 0, "ann", 5),
      tile(4, 0, "bob", 6),
    ];

    expect(playsSinceYourTurn(board, "you")).toEqual([
      play(5, ["2,0", "3,0"]),
      play(6, ["4,0"]),
    ]);
  });

  test("in the order they were played, not the order they are listed", () => {
    const board = [
      tile(4, 0, "bob", 6),
      tile(2, 0, "ann", 5),
      tile(1, 0, "you", 4),
    ];

    expect(playsSinceYourTurn(board, "you")).toEqual([
      play(5, ["2,0"]),
      play(6, ["4,0"]),
    ]);
  });

  test("your own earlier tiles are not news", () => {
    const board = [tile(0, 0, "you", 3), tile(1, 0, "ann", 4)];

    expect(playsSinceYourTurn(board, "you")).toEqual([play(4, ["1,0"])]);
  });

  test("nothing has happened since you played", () => {
    const board = [tile(0, 0, "ann", 1), tile(1, 0, "you", 2)];

    expect(playsSinceYourTurn(board, "you")).toEqual([]);
  });

  test("before your first turn, the play before yours on its own", () => {
    const board = [
      tile(0, 0, "ann", 1),
      tile(1, 0, "bob", 2),
      tile(2, 0, "cal", 3),
    ];

    expect(playsSinceYourTurn(board, "you")).toEqual([play(3, ["2,0"])]);
  });

  test("the opening play, seen by whoever answers it", () => {
    const board = [tile(7, 7, "ann", 1), tile(8, 7, "ann", 1)];

    expect(playsSinceYourTurn(board, "you")).toEqual([play(1, ["7,7", "8,7"])]);
  });
});

describe("the play that just landed", () => {
  test("the newest play by somebody else, every square it covers", () => {
    const board = [
      tile(0, 0, "ann", 3),
      tile(1, 0, "bob", 4),
      tile(2, 0, "bob", 4),
      tile(3, 0, "you", 5),
    ];

    expect(latestPlayByOthers(board, "you")).toEqual(play(4, ["1,0", "2,0"]));
  });

  test("nothing, when nobody else has played", () => {
    expect(latestPlayByOthers([tile(7, 7, "you", 1)], "you")).toBeNull();
  });
});

describe("what changed while you were gone, read off the history", () => {
  const turn = (turnNumber: number, userId: string, cells: [number, number][]) => ({
    turnNumber,
    userId,
    placements: cells.map(([x, y]) => ({ x, y })),
  });

  test("a tile the next play built on still belongs to the play that laid it", () => {
    const turns = [
      turn(4, "you", [[1, 0]]),
      turn(5, "ann", [[2, 0], [3, 0]]),
      turn(6, "bob", [[3, 0]]),
    ];

    expect(playsInHistorySinceYourTurn(turns, "you")).toEqual([
      play(5, ["2,0", "3,0"]),
      play(6, ["3,0"]),
    ]);
  });

  test("a play covered entirely is still replayed", () => {
    const turns = [turn(4, "you", [[1, 0]]), turn(5, "ann", [[2, 0]]), turn(6, "bob", [[2, 0]])];

    expect(playsInHistorySinceYourTurn(turns, "you")).toEqual([
      play(5, ["2,0"]),
      play(6, ["2,0"]),
    ]);
  });

  test("a trade or a pass was your turn too", () => {
    const turns = [turn(1, "ann", [[0, 0]]), turn(2, "you", []), turn(3, "bob", [[1, 0]])];

    expect(playsInHistorySinceYourTurn(turns, "you")).toEqual([play(3, ["1,0"])]);
  });

  test("a turn that laid nothing is not a play to replay", () => {
    const turns = [turn(1, "you", [[0, 0]]), turn(2, "ann", []), turn(3, "bob", [[5, 5]])];

    expect(playsInHistorySinceYourTurn(turns, "you")).toEqual([play(3, ["5,5"])]);
  });

  test("before your first turn, the play before yours on its own", () => {
    const turns = [turn(1, "ann", [[0, 0]]), turn(2, "bob", [[1, 0]])];

    expect(playsInHistorySinceYourTurn(turns, "you")).toEqual([play(2, ["1,0"])]);
  });
});
