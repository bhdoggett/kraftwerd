import { describe, expect, test } from "vitest";
import { refill, type RackConfig } from "./rack.js";

/** Deterministic, well-distributed generator so tests are reproducible. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

const config: RackConfig = {
  size: 7,
  weights: { A: 100, E: 100, I: 100, O: 100, U: 100, T: 100, S: 100, Z: 100 },
  vowels: "AEIOU",
  minVowels: 3,
  maxDuplicates: 2,
};

const vowelCount = (letters: string[]) => letters.filter((l) => "AEIOU".includes(l)).length;

const duplicateMax = (letters: string[]) => {
  const counts = new Map<string, number>();
  for (const l of letters) counts.set(l, (counts.get(l) ?? 0) + 1);
  return Math.max(...counts.values());
};

/** Every rack from 400 different seeds. */
const sample = (cfg: RackConfig = config, keep: string[] = []) =>
  Array.from({ length: 400 }, (_, i) => refill(keep, seeded(i + 1), cfg).letters);

describe("refill", () => {
  test("fills an empty rack to the configured size", () => {
    expect(refill([], seeded(1), config).letters).toHaveLength(7);
  });

  test("keeps the letters it was given and tops up around them", () => {
    const rack = refill(["Z", "Z"], seeded(7), config);

    expect(rack.letters.slice(0, 2)).toEqual(["Z", "Z"]);
    expect(rack.letters).toHaveLength(7);
  });

  test("returns the rack unchanged when it is already full", () => {
    const full = ["A", "E", "I", "O", "U", "T", "S"];

    expect(refill(full, seeded(3), config).letters).toEqual(full);
  });

  test("always refills the blank slot", () => {
    expect(refill([], seeded(2), config).blank).toBe(true);
  });

  test("never exceeds the duplicate cap", () => {
    for (const letters of sample()) expect(duplicateMax(letters)).toBeLessThanOrEqual(2);
  });

  test("always meets the vowel floor", () => {
    for (const letters of sample()) expect(vowelCount(letters)).toBeGreaterThanOrEqual(3);
  });

  test("meets the vowel floor even when handed a rack full of consonants", () => {
    // 4 consonants kept, 3 slots left, 3 vowels needed: every draw must be a vowel
    for (const letters of sample(config, ["T", "S", "Z", "T"])) {
      expect(vowelCount(letters)).toBeGreaterThanOrEqual(3);
    }
  });

  test("never draws a letter with no weight", () => {
    const narrow: RackConfig = { ...config, weights: { ...config.weights, Z: 0 } };

    for (const letters of sample(narrow)) expect(letters).not.toContain("Z");
  });

  test("is deterministic for a given generator", () => {
    expect(refill([], seeded(42), config)).toEqual(refill([], seeded(42), config));
  });

  test("draws heavily weighted letters more often than light ones", () => {
    const skewed: RackConfig = {
      ...config,
      minVowels: 0,
      maxDuplicates: 7,
      weights: { E: 900, Z: 100 },
      vowels: "E",
    };
    const all = sample(skewed).flat();
    const es = all.filter((l) => l === "E").length;

    expect(es / all.length).toBeGreaterThan(0.8);
    expect(es / all.length).toBeLessThan(0.98);
  });

  test("cannot satisfy an impossible vowel floor, but still fills the rack", () => {
    const impossible: RackConfig = {
      ...config,
      weights: { T: 100, S: 100 },
      minVowels: 3,
    };
    const rack = refill([], seeded(9), impossible);

    expect(rack.letters).toHaveLength(7);
    expect(vowelCount(rack.letters)).toBe(0);
  });
});
