import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { GAME, SQUARE_BONUS } from "../config";
import { makeBoard } from "../engine/board";
import { blankPrice, DEFAULT_EXPOSURE, exposure } from "./judgement";

const shape = boardShapeNamed(OPEN_BOARD, 15);
const at = (x: number, y: number, letter: string) => ({ x, y, letter, isBlank: false });

describe("exposure", () => {
  // Eight of a 3x3's nine squares at (6,6), all but the bottom-right corner
  // and the one the move lays at (6,8).
  const nearly = () =>
    makeBoard(
      [[6, 6], [7, 6], [8, 6], [6, 7], [7, 7], [8, 7], [7, 8]].map(([x, y]) => at(x, y, "A")),
    );

  test("a move leaving a 3x3 one tile short is charged a share of the square", () => {
    const risky = exposure(nearly(), [at(6, 8, "T")], shape, 15, { openRun: 0 });
    expect(risky).toBeCloseTo(DEFAULT_EXPOSURE.nearBlock * SQUARE_BONUS);
  });

  test("closing the block yourself leaves nothing to take", () => {
    const withCorner = new Map(nearly());
    withCorner.set("6,8", { letter: "T", isBlank: false, stacked: 1 });
    const closing = exposure(withCorner, [at(8, 8, "O")], shape, 15, { openRun: 0 });
    expect(closing).toBe(0);
  });

  test("a 2x2 one short is not charged: it pays nothing", () => {
    const before = makeBoard([at(7, 7, "A"), at(8, 7, "T")]);
    expect(exposure(before, [at(7, 8, "T")], shape, 15, { openRun: 0 })).toBe(0);
  });

  test("a longer word left open is worth more to the opponent", () => {
    const short = makeBoard([at(6, 7, "A"), at(7, 7, "T")]);
    const long = makeBoard([...["C", "A", "T", "S"].map((l, i) => at(4 + i, 7, l))]);

    expect(exposure(long, [at(8, 7, "O")], shape, 15))
      .toBeGreaterThan(exposure(short, [at(8, 7, "O")], shape, 15));
  });

  test("weights can be turned off individually", () => {
    // The move leaves a 3x3 one short *and* open runs, so both terms are
    // charged and each can be shown to carry its own weight. Nowhere near a
    // multiplier, so that term is zero throughout.
    const before = nearly();
    const placements = [at(6, 8, "T")];
    const all = exposure(before, placements, shape, 15);

    const noBlocks = exposure(before, placements, shape, 15, { nearBlock: 0 });
    const noRuns = exposure(before, placements, shape, 15, { openRun: 0 });

    expect(noBlocks).toBeGreaterThan(0);
    expect(noBlocks).toBeLessThan(all);
    expect(noRuns).toBeGreaterThan(0);
    expect(noRuns).toBeLessThan(all);
    // Each accounts for the whole of what the other leaves out.
    expect(noBlocks + noRuns).toBeCloseTo(all);

    expect(exposure(before, placements, shape, 15,
      { nearBlock: 0, openRun: 0 })).toBe(0);
  });

  test("the defaults are the ones the spec names", () => {
    expect(DEFAULT_EXPOSURE).toEqual({ nearBlock: 0.5, openRun: 0.15 });
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
