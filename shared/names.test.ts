import { describe, expect, test } from "vitest";
import { drawNames, NAMES, robotName, ROBOT_PREFIX } from "./names";

/** A rigged rng: hands back the numbers given, then zeroes forever. */
const rigged = (...values: number[]) => {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0);
};

describe("the name pool", () => {
  test("is all one word, so a name fits a scoreboard row", () => {
    for (const name of NAMES) expect(name).not.toMatch(/\s/);
  });

  test("has no duplicates, or a draw could seat one name twice", () => {
    expect(new Set(NAMES).size).toBe(NAMES.length);
  });

  test("is big enough that a full table has choices left", () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(40);
  });
});

describe("drawing names", () => {
  test("draws the number asked for", () => {
    expect(drawNames(3, Math.random)).toHaveLength(3);
  });

  test("draws from the pool and nothing else", () => {
    for (const name of drawNames(3, Math.random)) expect(NAMES).toContain(name);
  });

  test("never draws one name twice", () => {
    for (let i = 0; i < 100; i++) {
      const drawn = drawNames(6, Math.random);
      expect(new Set(drawn).size).toBe(drawn.length);
    }
  });

  test("avoids the names already at the table", () => {
    const taken = NAMES.slice(0, NAMES.length - 1);
    expect(drawNames(1, Math.random, taken)).toEqual([NAMES[NAMES.length - 1]]);
  });

  test("the same rng draws the same names, so a test can pin them", () => {
    const draw = () => drawNames(2, rigged(0, 0));
    expect(draw()).toEqual(draw());
  });

  test("asking for more names than exist gives back every one, once", () => {
    const drawn = drawNames(NAMES.length + 5, Math.random);
    expect(new Set(drawn).size).toBe(NAMES.length);
  });
});

describe("what a machine is called", () => {
  test("wears the prefix, so no seat is mistaken for a person", () => {
    expect(robotName("Gawain", "medium")).toBe("Robo-Gawain (medium)");
  });

  test("the prefix is the one the pool check knows about", () => {
    expect(robotName("Egil", "hard").startsWith(ROBOT_PREFIX)).toBe(true);
  });

  test("no name in the pool already wears it", () => {
    for (const name of NAMES) expect(name.startsWith(ROBOT_PREFIX)).toBe(false);
  });
});
