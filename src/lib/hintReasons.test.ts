import { describe, expect, test } from "vitest";
import { blanksLabel, reasonsOf } from "./hintReasons";

const move = (over: object) => ({
  placements: [],
  total: 0,
  words: [],
  squares: 0,
  leavesOpen: 0,
  ...over,
});

describe("reasonsOf", () => {
  test("a square, a multiplier, a long word and a warning, in that order", () => {
    expect(
      reasonsOf(
        move({
          squares: 1,
          words: [
            { word: "STAB", points: 12, rare: false, multiplier: 3 },
            { word: "BOATS", points: 5, rare: false, long: true },
          ],
          leavesOpen: 1,
        }),
      ),
    ).toEqual(["closes a 3×3 (+33)", "×3 on STAB", "long word (+5)", "leaves a 3×3 one tile short"]);
  });

  test("two squares say two", () => {
    expect(reasonsOf(move({ squares: 2 }))).toEqual(["closes 2 3×3s (+66)"]);
  });

  test("a plain word has no reasons", () => {
    expect(reasonsOf(move({ words: [{ word: "CAT", points: 3, rare: false }] }))).toEqual([]);
  });
});

describe("blanksLabel", () => {
  const tile = (isBlank: boolean) => ({ x: 0, y: 0, letter: "A", isBlank });

  test("counts the blanks a hint spends", () => {
    expect(blanksLabel(move({ placements: [tile(false), tile(false)] }))).toBe("no blanks");
    expect(blanksLabel(move({ placements: [tile(true), tile(false)] }))).toBe("1 blank");
    expect(blanksLabel(move({ placements: [tile(true), tile(true), tile(true)] }))).toBe("3 blanks");
  });
});
