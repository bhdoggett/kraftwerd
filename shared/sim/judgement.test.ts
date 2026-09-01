import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { GAME } from "../config";
import { makeBoard } from "../engine/board";
import { blankPrice, DEFAULT_EXPOSURE, exposure } from "./judgement";

const shape = boardShapeNamed(OPEN_BOARD, 15);
const at = (x: number, y: number, letter: string) => ({ x, y, letter, isBlank: false });

describe("exposure", () => {
  test("a move leaving a 2x2 one tile short is penalised", () => {
    // Three corners of a 2x2 at (7,7). The move adds the third; the fourth
    // is a four-point gift to whoever plays next.
    const before = makeBoard([at(7, 7, "A"), at(8, 7, "T")]);
    const risky = exposure(before, [at(7, 8, "T")], shape, 15);

    expect(risky).toBeGreaterThan(0);
  });

  test("closing the block yourself leaves nothing to take", () => {
    const before = makeBoard([at(7, 7, "A"), at(8, 7, "T"), at(7, 8, "T")]);

    const closing = exposure(before, [at(8, 8, "O")], shape, 15);
    const opening = exposure(makeBoard([at(7, 7, "A"), at(8, 7, "T")]),
      [at(7, 8, "T")], shape, 15);

    expect(closing).toBeLessThan(opening);
  });

  test("a longer word left open is worth more to the opponent", () => {
    const short = makeBoard([at(6, 7, "A"), at(7, 7, "T")]);
    const long = makeBoard([...["C", "A", "T", "S"].map((l, i) => at(4 + i, 7, l))]);

    expect(exposure(long, [at(8, 7, "O")], shape, 15))
      .toBeGreaterThan(exposure(short, [at(8, 7, "O")], shape, 15));
  });

  test("weights can be turned off individually", () => {
    const before = makeBoard([at(7, 7, "A"), at(8, 7, "T")]);
    const off = exposure(before, [at(7, 8, "T")], shape, 15,
      { nearBlock: 0, openRun: 0, stackable: 0 });

    expect(off).toBe(0);
  });

  test("the defaults are the ones the spec names", () => {
    expect(DEFAULT_EXPOSURE).toEqual({ nearBlock: 0.6, openRun: 0.15, stackable: 0.1 });
  });
});

describe("the price of a blank", () => {
  const spent = [{ x: 7, y: 7, letter: "E", isBlank: true }];

  test("costs nothing when no blank is spent", () => {
    expect(blankPrice(makeBoard([]), [at(7, 7, "E")], 8)).toBe(0);
  });

  test("is dear early, when most of the game is still to come", () => {
    expect(blankPrice(makeBoard([]), spent, 8)).toBeCloseTo(8);
  });

  test("falls to nothing as the board fills", () => {
    // A blank still in hand when the game ends is worth exactly zero, so its
    // reserve price has to reach zero with it.
    const nearlyDone = makeBoard(
      Array.from({ length: GAME.endThreshold }, (_, i) => at(i % 15, Math.floor(i / 15), "A")),
    );
    expect(blankPrice(nearlyDone, spent, 8)).toBe(0);
  });

  test("charges for each blank spent", () => {
    const two = [
      { x: 7, y: 7, letter: "E", isBlank: true },
      { x: 8, y: 7, letter: "M", isBlank: true },
    ];
    expect(blankPrice(makeBoard([]), two, 8)).toBeCloseTo(16);
  });
});
