import { describe, expect, test } from "vitest";
import { makeBoard } from "../../shared/engine/board";
import type { Placement } from "../../shared/engine/score";
import { markCells } from "./boardFeedback";

const at = (x: number, y: number, letter: string): Placement => ({
  x,
  y,
  letter,
  isBlank: false,
});

const valid = (...words: string[]) => new Map(words.map((w) => [w, true]));

describe("markCells", () => {
  test("marks placed tiles of a word that checks out", () => {
    const placements = [at(0, 0, "A"), at(1, 0, "T")];
    const { good, bad } = markCells(makeBoard(placements), placements, valid("AT"));

    expect([...good].sort()).toEqual(["0,0", "1,0"]);
    expect([...bad]).toEqual([]);
  });

  test("marks a word that is not in the dictionary", () => {
    const placements = [at(0, 0, "X"), at(1, 0, "Q")];
    const { good, bad } = markCells(makeBoard(placements), placements, valid());

    expect([...bad].sort()).toEqual(["0,0", "1,0"]);
    expect([...good]).toEqual([]);
  });

  test("does not mark tiles that were already on the board", () => {
    const board = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
      { x: 2, y: 0, letter: "E" },
    ]);
    const { good } = markCells(board, [at(2, 0, "E")], valid("ATE"));

    // The whole word is judged, but only this turn's tile is coloured.
    expect([...good]).toEqual(["2,0"]);
  });

  test("a square in a good word one way and a bad one the other shows the problem", () => {
    // A T   across AT is a word, down AT and TO are not both known here.
    // T O
    const placements = [at(0, 0, "A"), at(1, 0, "T"), at(0, 1, "T"), at(1, 1, "O")];
    const { good, bad } = markCells(makeBoard(placements), placements, valid("AT"));

    expect(bad.has("1,1")).toBe(true);
    expect(good.has("1,1")).toBe(false);
  });

  test("a lone tile has to be a word in its own right", () => {
    const lone = markCells(makeBoard([at(4, 4, "Q")]), [at(4, 4, "Q")], valid("A", "I"));
    expect([...lone.bad]).toEqual(["4,4"]);

    const ok = markCells(makeBoard([at(4, 4, "A")]), [at(4, 4, "A")], valid("A", "I"));
    expect([...ok.good]).toEqual(["4,4"]);
  });

  test("a good word that does not reach the board is still marked wrong", () => {
    const board = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 5, y: 5, letter: "A" },
      { x: 6, y: 5, letter: "T" },
    ]);
    const placements = [at(5, 5, "A"), at(6, 5, "T")];
    const { bad } = markCells(board, placements, valid("AT", "A"));

    expect([...bad].sort()).toEqual(["5,5", "6,5"]);
  });
});
