/**
 * Play a lot of games, so a rules change can be argued about with numbers.
 *
 * Usage: node scripts/simulate.ts [games] [players]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeDictionary } from "../shared/engine/dictionary.ts";
import { indexWords } from "../shared/sim/bot.ts";
import { playGame, type GameResult } from "../shared/sim/game.ts";
import type { Variant } from "../shared/sim/variants.ts";
import { RACK } from "../shared/config.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const games = Number(process.argv[2] ?? 40);
const players = Number(process.argv[3] ?? 2);

const words: string[] = JSON.parse(
  readFileSync(join(ROOT, "shared", "data", "words.json"), "utf8"),
);
const dictionary = makeDictionary(words);
const index = indexWords(words, 7);

/** Deterministic, so two variants meet the same draws. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Who won, by seat: ties count for each leader. */
function winners(scores: readonly number[]) {
  const best = Math.max(...scores);
  return scores.map((score) => (score === best ? 1 / scores.filter((s) => s === best).length : 0));
}

/**
 * Build a bag of a given size at a given vowel share.
 *
 * Vowels are split by how often English uses them, consonants in the
 * proportions the hand-written bag already uses, and every letter keeps at
 * least one tile — dropping the Q by rounding would be a rules change
 * disguised as arithmetic. Size and vowel share move independently, which is
 * the whole point: "more vowels" and "more tiles" are separate questions that
 * a single scaled weights file cannot tell apart.
 */
function makeBag(size: number, vowelShare: number): Record<string, number> {
  const VOWEL_SPLIT: Record<string, number> = { A: 8.2, E: 12.7, I: 7.0, O: 7.5, U: 2.8 };
  const consonants = Object.fromEntries(
    Object.entries(RACK.weights).filter(([l]) => !"AEIOU".includes(l)),
  );

  const share = (weights: Record<string, number>, tiles: number) => {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    const out: Record<string, number> = {};
    let given = 0;
    for (const [letter, weight] of Object.entries(weights)) {
      const n = Math.max(1, Math.round((weight / total) * tiles));
      out[letter] = n;
      given += n;
    }
    // Settle the rounding on the commonest letters, which can spare a tile
    // either way without changing what the bag feels like.
    const order = Object.entries(weights)
      .sort((a, b) => b[1] - a[1])
      .map(([l]) => l);
    let i = 0;
    while (given !== tiles) {
      const letter = order[i % order.length]!;
      if (given > tiles && out[letter]! > 1) {
        out[letter]!--;
        given--;
      } else if (given < tiles) {
        out[letter]!++;
        given++;
      }
      i++;
    }
    return out;
  };

  const vowels = Math.round(size * vowelShare);
  return { ...share(VOWEL_SPLIT, vowels), ...share(consonants, size - vowels) };
}

const CURRENT = RACK.weights as Record<string, number>;

const VARIANTS: Variant[] = [
  { name: "now: 50 / 26% vowels", bag: 50, multiplier: "none", weights: CURRENT },
  { name: "50 / 33%", bag: 50, multiplier: "none", weights: makeBag(50, 0.33) },
  { name: "50 / 42%", bag: 50, multiplier: "none", weights: makeBag(50, 0.42) },
  { name: "62 / 26%", bag: 62, multiplier: "none", weights: makeBag(62, 0.26) },
  { name: "62 / 33%", bag: 62, multiplier: "none", weights: makeBag(62, 0.33) },
  { name: "62 / 42%", bag: 62, multiplier: "none", weights: makeBag(62, 0.42) },
];

for (const v of VARIANTS) {
  const w = v.weights!;
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  const vowels = [..."AEIOU"].reduce((n, c) => n + (w[c] ?? 0), 0);
  const hard = [..."JQXZ"].reduce((n, c) => n + (w[c] ?? 0), 0);
  console.error(
    `${v.name}: ${total} tiles, ${vowels} vowels (${((vowels / total) * 100).toFixed(0)}%), ` +
      `JQXZ ${((hard / total) * 100).toFixed(1)}%`,
  );
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const pct = (xs: number[], p: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
};

const rows: Record<string, string>[] = [];

for (const variant of VARIANTS) {
  const results: GameResult[] = [];
  const started = Date.now();
  for (let i = 0; i < games; i++) {
    results.push(playGame(variant, players, dictionary, index, seeded(i + 1)));
  }

  const winning = results.map((r) => Math.max(...r.scores));
  const margins = results.map((r) => {
    const [top, second] = [...r.scores].sort((a, b) => b - a);
    return (top ?? 0) - (second ?? 0);
  });
  const rare = results.map((r) => r.rarePlayed.length);
  const bigSquares = results.map((r) =>
    Object.entries(r.squares).reduce((n, [k, v]) => n + (Number(k) >= 3 ? v : 0), 0),
  );

  const seatWins = results.reduce(
    (totals, r) => winners(r.scores).map((w, i) => (totals[i] ?? 0) + w),
    [] as number[],
  );
  const seatScores = results.reduce(
    (totals, r) => r.scores.map((sc, i) => (totals[i] ?? 0) + sc),
    [] as number[],
  );

  rows.push({
    variant: variant.name,
    ...Object.fromEntries(
      seatWins.map((w, i) => [`seat ${i} win%`, ((w / games) * 100).toFixed(0)]),
    ),
    ...Object.fromEntries(
      seatScores.map((sc, i) => [`seat ${i} pts`, (sc / games).toFixed(0)]),
    ),
    "win score": mean(winning).toFixed(0),
    margin: mean(margins).toFixed(0),
    turns: mean(results.map((r) => r.turns)).toFixed(0),
    tiles: mean(results.map((r) => r.tilesPlaced)).toFixed(0),
    passes: mean(results.map((r) => r.passes)).toFixed(1),
    "best turn": mean(results.map((r) => r.bestTurn)).toFixed(0),
    "top turn": pct(results.map((r) => r.bestTurn), 0.95).toFixed(0),
    "rare/game": mean(rare).toFixed(2),
    "3x3+": mean(bigSquares).toFixed(2),
    "dry %": ((results.filter((r) => r.ranDry).length / games) * 100).toFixed(0),
    "edge gap": mean(results.map((r) => r.edgeMargin)).toFixed(1),
    secs: ((Date.now() - started) / 1000).toFixed(1),
  });
  console.error(`  ${variant.name}: done`);
}

console.log(`\n${games} games, ${players} players, identical draws across variants\n`);
console.table(rows);
