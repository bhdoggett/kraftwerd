import { describe, expect, test } from "vitest";
import { bagFromWeights, draw, tilesLeft } from "./bag";

const weights = { A: 8, B: 2, C: 1 };

describe("a finite bag", () => {
  test("holds the asked-for number of tiles, in proportion to the weights", () => {
    const bag = bagFromWeights(weights, 22);

    expect(tilesLeft(bag)).toBe(22);
    // 8:2:1 of 22 is 16, 4, 2.
    expect(bag.get("A")).toBe(16);
    expect(bag.get("C")).toBe(2);
  });

  test("every letter with weight gets at least one tile", () => {
    const bag = bagFromWeights({ A: 100, Z: 1 }, 10);
    expect(bag.get("Z")).toBeGreaterThanOrEqual(1);
  });

  test("drawing takes tiles out, and they do not come back", () => {
    const bag = bagFromWeights({ A: 1 }, 3);

    expect(draw(bag, 2, () => 0)).toEqual(["A", "A"]);
    expect(tilesLeft(bag)).toBe(1);
  });

  test("an empty bag draws nothing rather than hanging", () => {
    const bag = bagFromWeights({ A: 1 }, 2);

    expect(draw(bag, 5, () => 0)).toHaveLength(2);
    expect(draw(bag, 1, () => 0)).toEqual([]);
    expect(tilesLeft(bag)).toBe(0);
  });
});

describe("a flat bag", () => {
  test("holds two of everything and one of each hard letter", async () => {
    const { bagFlat } = await import("./bag");
    const bag = bagFlat();

    expect(bag.get("E")).toBe(2);
    expect(bag.get("Q")).toBe(1);
    expect(tilesLeft(bag)).toBe(22 * 2 + 4);
  });
});
