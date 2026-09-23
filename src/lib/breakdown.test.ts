import { describe, expect, test } from "vitest";
import { SQUARE_BONUS } from "../../shared/config";
import { squareBreakdown } from "./breakdown";

describe("the square bonus, split up", () => {
  test("a completed square is worth what the rules pay for it", () => {
    // It used to say `size * size` -- 9 for a 3x3 -- which was the rule until
    // squares went flat. The turn's total collected SQUARE_BONUS all along,
    // so the table explaining the total disagreed with it by 24 a square.
    expect(squareBreakdown([3])).toEqual([
      { size: "3×3", count: 1, total: SQUARE_BONUS },
    ]);
  });

  test("two squares in one turn pay twice", () => {
    expect(squareBreakdown([3, 3])).toEqual([
      { size: "3×3", count: 2, total: 2 * SQUARE_BONUS },
    ]);
  });

  test("a turn that completed nothing has no rows", () => {
    expect(squareBreakdown([])).toEqual([]);
  });

  test("sizes are kept apart, smallest first", () => {
    // Only one size pays today, so this is about the shape holding up rather
    // than about a rule: the row's label comes from the data, not from an
    // assumption that every block is a 3x3.
    expect(squareBreakdown([4, 3, 4])).toEqual([
      { size: "3×3", count: 1, total: SQUARE_BONUS },
      { size: "4×4", count: 2, total: 2 * SQUARE_BONUS },
    ]);
  });
});
