import { describe, expect, test } from "vitest";
import { playedSinceYourTurn } from "./recap";

const tile = (x: number, y: number, placedBy: string, turnNumber: number) => ({
  x,
  y,
  placedBy,
  turnNumber,
});

describe("what changed while you were gone", () => {
  test("an empty board has nothing to point out", () => {
    expect(playedSinceYourTurn([], "you")).toEqual(new Set());
  });

  test("everything played since your last turn, at a table of four", () => {
    const board = [
      tile(0, 0, "you", 1),
      tile(1, 0, "you", 5),
      tile(2, 0, "ann", 6),
      tile(3, 0, "bob", 7),
      tile(4, 0, "cal", 8),
    ];

    expect(playedSinceYourTurn(board, "you")).toEqual(
      new Set(["2,0", "3,0", "4,0"]),
    );
  });

  test("your own earlier tiles are not news", () => {
    const board = [tile(0, 0, "you", 3), tile(1, 0, "ann", 4)];

    expect(playedSinceYourTurn(board, "you")).toEqual(new Set(["1,0"]));
  });

  test("nothing has happened since you played", () => {
    const board = [tile(0, 0, "ann", 1), tile(1, 0, "you", 2)];

    expect(playedSinceYourTurn(board, "you")).toEqual(new Set());
  });

  test("before your first turn, the play before yours on its own", () => {
    const board = [
      tile(0, 0, "ann", 1),
      tile(1, 0, "bob", 2),
      tile(2, 0, "cal", 3),
    ];

    expect(playedSinceYourTurn(board, "you")).toEqual(new Set(["2,0"]));
  });

  test("the opening play, seen by whoever answers it", () => {
    const board = [tile(7, 7, "ann", 1), tile(8, 7, "ann", 1)];

    expect(playedSinceYourTurn(board, "you")).toEqual(new Set(["7,7", "8,7"]));
  });
});
