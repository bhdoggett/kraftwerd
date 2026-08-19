import { describe, expect, test } from "vitest";
import { RACK } from "../config.js";
import words from "../data/words.json" with { type: "json" };
import { makeBoard } from "./board.js";
import { refill } from "./rack.js";
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

  test("a real 2x2 word square is legal and scores 8", () => {
    const before = makeBoard([]);

    expect(validateTurn(before, SQUARE, dict, bounds)).toEqual({ ok: true });
    expect(scoreTurn(applyPlacements(before, SQUARE), SQUARE).total).toBe(8);
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
    expect(scoreTurn(applyPlacements(before, mine), mine).total).toBe(5);
  });

  test("a 3x3 built over two turns scores 34 in total", () => {
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

    // 8 tiles + the three 2x2 blocks that are already complete
    const after1 = applyPlacements(empty, turn1);
    const first = scoreTurn(after1, turn1);
    expect(first.total).toBe(8 + 12);

    // Turn 2: the last corner completes EMU across and down.
    const turn2 = [at(2, 2, "U")];
    expect(validateTurn(after1, turn2, dict, bounds)).toEqual({ ok: true });

    // 1 tile + the final 2x2 (4) + the 3x3 itself (9)
    const second = scoreTurn(applyPlacements(after1, turn2), turn2);
    expect(second.total).toBe(1 + 4 + 9);

    // and the two turns together pay the 34 that design.md §4.2 quotes
    expect(first.total + second.total).toBe(34);
  });
});

describe("racks drawn from the real letter weights", () => {
  const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const racks = Array.from({ length: 1000 }, (_, i) => refill([], seeded(i + 1), RACK).letters);

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

    // Short words run ~35% vowels. With the floor at 1 the draw is close to
    // that naturally; a much higher share would mean the floor is doing the
    // dealing rather than the weights.
    expect(share).toBeGreaterThan(0.28);
    expect(share).toBeLessThan(0.45);
  });

  test("a rack is never dealt without a vowel", () => {
    for (const rack of racks) {
      expect(rack.some((l) => "AEIOU".includes(l))).toBe(true);
    }
  });

  test("the awkward letters turn up often enough to notice, without crowding", () => {
    const letters = racks.flat();
    const hostile = letters.filter((l) => "JQXZ".includes(l)).length;
    const share = hostile / letters.length;

    // RARE_FLOOR lifts these above their natural ~1.4%: rare enough to stay
    // interesting, common enough that a player actually meets them.
    expect(share).toBeGreaterThan(0.03);
    expect(share).toBeLessThan(0.09);
  });

  test("a rack can still spell something despite the awkward letters", () => {
    const playable = racks.filter((r) => short.some((w) => canSpell(r, w))).length;

    expect(playable / racks.length).toBeGreaterThan(0.95);
  });
});
