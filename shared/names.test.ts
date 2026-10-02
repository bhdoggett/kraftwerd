import { describe, expect, test } from "vitest";
import {
  asShown,
  checkDisplayName,
  drawNames,
  NAMES,
  robotName,
  ROBOT_PREFIX,
  withoutLevel,
} from "./names";

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
  test("its name and its level, so no seat is mistaken for a person", () => {
    expect(robotName("Gawain", "medium")).toBe("Gawain (medium)");
  });

  test("an older machine shows without the prefix it was stored with", () => {
    expect(asShown("Robo-Egil (hard)")).toBe("Egil (hard)");
    expect(asShown("Egil (hard)")).toBe("Egil (hard)");
  });

  test("no name in the pool starts with the old prefix", () => {
    for (const name of NAMES) expect(name.startsWith(ROBOT_PREFIX)).toBe(false);
  });
});

describe("a name without its level", () => {
  test("drops a machine's level", () => {
    expect(withoutLevel(robotName("Ada", "medium"))).toBe("Ada");
  });

  test("leaves a person's name alone, brackets and all", () => {
    expect(withoutLevel("Sam (work)")).toBe("Sam (work)");
    expect(withoutLevel("Ana")).toBe("Ana");
  });
});


describe("checkDisplayName", () => {
  test("trims and collapses spaces", () => {
    expect(checkDisplayName("  Word   Nerd ")).toEqual({ ok: true, name: "Word Nerd" });
  });

  test("allows letters from any script", () => {
    expect(checkDisplayName("Zoë").ok).toBe(true);
    expect(checkDisplayName("ゆき").ok).toBe(true);
  });

  test("refuses names too short or too long", () => {
    expect(checkDisplayName(" a ").ok).toBe(false);
    expect(checkDisplayName("x".repeat(25)).ok).toBe(false);
  });

  test("refuses an email address", () => {
    expect(checkDisplayName("ana@gmail.com").ok).toBe(false);
  });

  test("refuses brackets, so nobody can pass for a machine", () => {
    expect(checkDisplayName("Gawain (hard)").ok).toBe(false);
  });
});
