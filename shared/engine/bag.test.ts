import { describe, expect, test } from "vitest";
import { draw, newBag, returnTiles, tilesLeft } from "./bag.js";

const config = {
  size: 7,
  weights: { A: 3, B: 2, Z: 1 },
  vowels: "AEIOU",
  minVowels: 2,
  maxDuplicates: 2,
};

describe("the bag", () => {
  test("holds exactly what the weights say", () => {
    const bag = newBag(config);

    expect(bag).toEqual({ A: 3, B: 2, Z: 1 });
    expect(tilesLeft(bag)).toBe(6);
  });

  test("a drawn tile leaves the bag", () => {
    const { drawn, bag } = draw(newBag(config), 2, () => 0);

    expect(drawn).toHaveLength(2);
    expect(tilesLeft(bag)).toBe(4);
  });

  test("the last of a letter is gone for good", () => {
    // rng at 0.99 reaches the end of the counts, which is the Z.
    const { drawn, bag } = draw(newBag(config), 1, () => 0.99);

    expect(drawn).toEqual(["Z"]);
    expect(bag.Z).toBeUndefined();
  });

  test("an empty bag gives what it has and no more", () => {
    const { drawn, bag } = draw(newBag(config), 20, () => 0);

    expect(drawn).toHaveLength(6);
    expect(tilesLeft(bag)).toBe(0);
    expect(draw(bag, 3, () => 0).drawn).toEqual([]);
  });

  test("traded tiles go back in", () => {
    // Three draws at the low end take all three As, so the bag has none left.
    const { bag } = draw(newBag(config), 3, () => 0);
    expect(bag.A).toBeUndefined();

    const back = returnTiles(bag, ["A", "A"]);

    expect(tilesLeft(back)).toBe(tilesLeft(bag) + 2);
    expect(back.A).toBe(2);
  });

  test("drawing does not change the bag it was given", () => {
    const bag = newBag(config);
    draw(bag, 4, () => 0);

    expect(tilesLeft(bag)).toBe(6);
  });
});
