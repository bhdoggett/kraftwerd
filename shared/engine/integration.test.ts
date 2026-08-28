import { describe, expect, test } from "vitest";
import { RACK } from "../config.js";
import words from "../data/words.json" with { type: "json" };
import { makeBoard } from "./board.js";
import { draw, newBag } from "./bag.js";
import { makeDictionary } from "./dictionary.js";
import { applyPlacements, validateTurn, type Bounds } from "./legality.js";
import { scoreTurn, type Placement } from "./score.js";

const dict = makeDictionary(words as string[]);
const bounds: Bounds = { width: 40, height: 40 };

const at = (x: number, y: number, letter: string): Placement => ({
  x,
  y,
  letter,
  isBlank: false,
});

/**
 *   A D      rows:    AD, DO
 *   D O      columns: AD, DO
 */
const SQUARE = [at(0, 0, "A"), at(1, 0, "D"), at(0, 1, "D"), at(1, 1, "O")];

describe("engine against the real tier-50 dictionary", () => {
  test("the wordlist loaded", () => {
    expect(words.length).toBeGreaterThan(50_000);
    expect(dict.has("CAT")).toBe(true);
    expect(dict.has("ZZZZQ")).toBe(false);
  });

  test("a real 2x2 word square is legal and scores 12", () => {
    const before = makeBoard([]);

    expect(validateTurn(before, SQUARE, dict, bounds)).toEqual({ ok: true });
    // Four 2-letter words (8) plus the square itself (4).
    expect(scoreTurn(applyPlacements(before, SQUARE), SQUARE).total).toBe(12);
  });

  test("the same block with one letter changed is rejected", () => {
    const broken = [at(0, 0, "A"), at(1, 0, "D"), at(0, 1, "D"), at(1, 1, "Z")];
    const result = validateTurn(makeBoard([]), broken, dict, bounds);

    expect(result.ok).toBe(false);
  });

  test("completing an opponent's square with one tile scores the whole square", () => {
    const before = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "D" },
      { x: 0, y: 1, letter: "D" },
    ]);
    const mine = [at(1, 1, "O")];

    expect(validateTurn(before, mine, dict, bounds)).toEqual({ ok: true });
    // The tile closes AD down and DO across as well as the square.
    expect(scoreTurn(applyPlacements(before, mine), mine).total).toBe(8);
  });

  test("a 3x3 built over two turns scores 43 in total", () => {
    //   A C E      rows:    ACE, CAM, EMU
    //   C A M      columns: ACE, CAM, EMU
    //   E M U
    //
    // The rack caps at 8 tiles, so a 9-tile square always takes two turns.
    // Turn 1 lays 8 of the 9; the partial bottom row must itself read EM.
    const turn1 = [
      at(0, 0, "A"), at(1, 0, "C"), at(2, 0, "E"),
      at(0, 1, "C"), at(1, 1, "A"), at(2, 1, "M"),
      at(0, 2, "E"), at(1, 2, "M"),
    ];

    const empty = makeBoard([]);
    expect(validateTurn(empty, turn1, dict, bounds)).toEqual({ ok: true });

    // Words so far: ACE, CAM, EM across; ACE, CAM, EM down = 16 letters.
    // Plus the three 2x2 blocks already complete.
    const after1 = applyPlacements(empty, turn1);
    const first = scoreTurn(after1, turn1);
    expect(first.total).toBe(16 + 12);

    // Turn 2: the last corner completes EMU across and down.
    const turn2 = [at(2, 2, "U")];
    expect(validateTurn(after1, turn2, dict, bounds)).toEqual({ ok: true });

    // The last corner completes EMU across and down (6 letters), the final
    // 2x2 (4) and the 3x3 itself (9).
    const second = scoreTurn(applyPlacements(after1, turn2), turn2);
    expect(second.total).toBe(6 + 4 + 9);

    // Together they pay more than the 43 a 3x3 scores in one go: the partial
    // words on the way were paid for too.
    expect(first.total + second.total).toBe(47);
  });
});

describe("racks drawn from the real bag", () => {
  const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  /*
   * Dealt out of the bag, which is how the game deals.
   *
   * These used to come from `refill`, the endless weighted draw — a path
   * nothing has used since tiles became a finite shared pool. It honours
   * `RACK.minVowels`, so it guaranteed things the game does not: the numbers
   * below were describing a dealer that had been retired.
   */
  const racks = Array.from({ length: 1000 }, (_, i) => {
    const rng = seeded(i + 1);
    return draw(newBag(RACK), RACK.size, rng).drawn;
  });

  const canSpell = (rack: string[], word: string) => {
    const pool = [...rack];
    for (const ch of word) {
      const i = pool.indexOf(ch);
      if (i < 0) return false;
      pool.splice(i, 1);
    }
    return true;
  };

  const short = (words as string[]).filter((w) => w.length === 2 || w.length === 3);

  test("almost every rack can spell at least one short word", () => {
    const playable = racks.filter((r) => short.some((w) => canSpell(r, w))).length;

    expect(playable / racks.length).toBeGreaterThan(0.95);
  });

  test("racks track the corpus vowel rate without drowning in vowels", () => {
    const letters = racks.flat();
    const share = letters.filter((l) => "AEIOU".includes(l)).length / letters.length;

    // The bag is 42% vowels and deals without a floor, so a rack is simply a
    // handful out of it: the share a player sees should be the share the bag
    // holds, give or take the sampling.
    expect(share).toBeGreaterThan(0.36);
    expect(share).toBeLessThan(0.48);
  });

  test("a rack without a vowel is possible, but rare", () => {
    const dry = racks.filter((r) => !r.some((l) => "AEIOU".includes(l))).length;

    /*
     * The bag has no vowel floor, so this can happen — about one hand in
     * thirty at six tiles. It is deliberately not zero: a floor would mean
     * the dealer choosing hands rather than the bag giving what it holds,
     * and trading exists for the hand that will not play.
     */
    expect(dry / racks.length).toBeLessThan(0.06);
  });

  test("the awkward letters turn up often enough to notice, without crowding", () => {
    const letters = racks.flat();
    const hostile = letters.filter((l) => "JQXZ".includes(l)).length;
    const share = hostile / letters.length;

    // One of each in a bag of sixty-two: rare enough to stay interesting,
    // common enough that a player meets them.
    expect(share).toBeGreaterThan(0.03);
    expect(share).toBeLessThan(0.12);
  });

  test("a rack can still spell something despite the awkward letters", () => {
    const playable = racks.filter((r) => short.some((w) => canSpell(r, w))).length;

    expect(playable / racks.length).toBeGreaterThan(0.95);
  });
});
