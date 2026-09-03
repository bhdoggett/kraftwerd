import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { RACK } from "../config";
import { makeDictionary } from "../engine/dictionary";
import { indexWords } from "./words";
import { playGame } from "./game";
import type { Difficulty } from "./bot";

/*
 * A whole game is the only place the difficulty knob can be caught doing
 * nothing: `chooseRanked` has its own tests in bot.test.ts, and they would all
 * still pass if `playGame` never called it.
 *
 * Games are cut down to keep the file affordable -- a four-letter dictionary,
 * a nine-square board, a thirty-tile bag -- which costs about six seconds a
 * game against the fourteen the shipped configuration costs. Cut down, not
 * simplified: the search, the ranking and the bands are the shipped ones, and
 * a toy word list would give the bands too few moves to be a band of.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const all: string[] = JSON.parse(
  readFileSync(join(ROOT, "shared", "data", "words.json"), "utf8"),
);
const short = all.filter((w) => w.length <= 4);
const dictionary = makeDictionary(short);
const words = indexWords(short, 4);

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const WEIGHTS = RACK.weights as Record<string, number>;
const TOTAL = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
const VARIANT = {
  name: "cut down",
  bag: 30,
  multiplier: "none" as const,
  size: 9,
  weights: Object.fromEntries(
    Object.entries(WEIGHTS).map(([l, n]) => [l, Math.max(1, Math.round((n / TOTAL) * 30))]),
  ),
};

const play = (seed: number, difficulties?: readonly Difficulty[]) =>
  playGame(VARIANT, 2, dictionary, words, seeded(seed), difficulties);

describe("the simulator plays at a difficulty", () => {
  /*
   * The knob is wired, proved by mutation rather than asserted.
   *
   * Two things this fails on. Put `rank(...)[0]` back where `chooseRanked` is
   * -- the perfect chooser this used to be -- and the difficulty argument
   * stops being read, so both games come out identical. Collapse the three
   * bands in bot.ts to one and the same thing happens for the other reason:
   * same band, same rng stream, same picks.
   */
  test("the same seed played easy and played hard is two different games", () => {
    const easy = play(11, ["easy"]);
    const hard = play(11, ["hard"]);

    expect(hard.scores).not.toEqual(easy.scores);
  }, 60_000);

  /*
   * And wired the right way round, which "two different games" alone does not
   * say: a difficulty that changed the moves without changing their quality
   * would pass the test above and be worthless.
   *
   * Seats are mirrored every other seed because the board favours seat 1 by
   * about a dozen points (docs/design.md §6), which is a fair fraction of the
   * gap being measured; alternating cancels it. Fixed seeds, so this cannot
   * flake -- the margin below is slack for the search changing, not for luck.
   * As measured it is 625 to 463, a third clear; collapsing the bands brings
   * the two sides to within the seat advantage and fails this.
   */
  test("hard out-scores easy across six games head to head", () => {
    let hardTotal = 0;
    let easyTotal = 0;

    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const seats: Difficulty[] = seed % 2 === 1 ? ["hard", "easy"] : ["easy", "hard"];
      const result = play(seed, seats);
      const [first, second] = result.scores as [number, number];
      hardTotal += seats[0] === "hard" ? first : second;
      easyTotal += seats[0] === "hard" ? second : first;
    }

    expect(hardTotal).toBeGreaterThan(easyTotal * 1.15);
  }, 180_000);

  /*
   * What an unconfigured simulator plays at, which is the whole claim
   * docs/design.md §6 rests on: the table describes a bot somebody could be
   * dealt. Fails if the default goes back to the best move on offer.
   */
  test("with no difficulty given, every seat plays hard", () => {
    expect(play(7).scores).toEqual(play(7, ["hard"]).scores);
  }, 60_000);
});
