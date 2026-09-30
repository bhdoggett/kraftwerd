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
    const risky = exposure(nearly(), [at(6, 8, "T")], shape, 15, { openRun: 0, openBonus: 0 });
    expect(risky).toBeCloseTo(DEFAULT_EXPOSURE.nearBlock * SQUARE_BONUS);
  });

  test("closing the block yourself leaves nothing to take", () => {
    const withCorner = new Map(nearly());
    withCorner.set("6,8", { letter: "T", isBlank: false, stacked: 1 });
    const closing = exposure(withCorner, [at(8, 8, "O")], shape, 15, { openRun: 0, openBonus: 0 });
    expect(closing).toBe(0);
  });

  test("a 2x2 one short is not charged: it pays nothing", () => {
    const before = makeBoard([at(7, 7, "A"), at(8, 7, "T")]);
    expect(exposure(before, [at(7, 8, "T")], shape, 15, { openRun: 0, openBonus: 0 })).toBe(0);
  });

  test("bringing an uncovered multiplier within reach is charged by its multiple", () => {
    // Three squares below the x2 at (9,9), and below the x3 at (11,11), each
    // on a row and column with no other multiplier within reach.
    const two = exposure(makeBoard([]), [at(9, 12, "A")], shape, 15, { openRun: 0, nearBlock: 0 });
    const three = exposure(makeBoard([]), [at(11, 14, "A")], shape, 15, { openRun: 0, nearBlock: 0 });
    expect(two).toBeCloseTo(DEFAULT_EXPOSURE.openBonus * 1);
    expect(three).toBeCloseTo(DEFAULT_EXPOSURE.openBonus * 2);
  });

  test("a multiplier already within reach is not this move's doing", () => {
    const before = makeBoard([at(9, 11, "A")]);
    expect(exposure(before, [at(9, 12, "B")], shape, 15, { openRun: 0, nearBlock: 0 })).toBe(0);
  });

  test("covering the multiplier yourself leaves nothing to take", () => {
    expect(exposure(makeBoard([]), [at(11, 11, "A")], shape, 15, { openRun: 0, nearBlock: 0 }))
      .toBe(0);
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
      { nearBlock: 0, openRun: 0, openBonus: 0, stackable: 0 })).toBe(0);
  });

  test("stackable is off, and off is a decision rather than an omission", () => {
    // At STACK_CAP 2 the term is true of every placement on an empty square and
    // false for every one that stacks -- a flat tax that separates nothing, and
    // backwards, since it charges less for stacking than for playing fresh. It
    // stays in the interface for a cap above 2, so it must still work.
    expect(DEFAULT_EXPOSURE.stackable).toBe(0);

    const before = makeBoard([at(7, 7, "A"), at(8, 7, "T")]);
    const placements = [at(7, 8, "T")];

    expect(exposure(before, placements, shape, 15, { stackable: 1 }))
      .toBeCloseTo(exposure(before, placements, shape, 15) + placements.length);
  });

  test("the defaults are the ones the spec names", () => {
    expect(DEFAULT_EXPOSURE).toEqual({ nearBlock: 0.5, openBonus: 2, openRun: 0.15, stackable: 0 });
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
