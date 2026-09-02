/**
 * Play a lot of games, so a rules change can be argued about with numbers.
 *
 * Usage: node scripts/simulate.ts [games] [players]
 */
import { cpus } from "node:os";
import { Worker } from "node:worker_threads";
import { type GameResult } from "../shared/sim/game.ts";
import type { Variant } from "../shared/sim/variants.ts";
import { RACK } from "../shared/config.ts";

const games = Number(process.argv[2] ?? 40);
const players = Number(process.argv[3] ?? 2);

/*
 * Nothing to play is refused, not run.
 *
 * The pool is sized `Math.min(cpus().length, games)`, so zero games is zero
 * workers -- and `play` dispatches from a loop over the workers, so with none
 * it posts no message, registers no listener, and returns a promise nothing
 * can ever settle. The serial version this replaced finished on that input;
 * this one stops dead at the first `await`.
 *
 * Refused rather than resolved with an empty result set because every figure
 * in the table is a per-game mean: a zero-game run has nothing to report but
 * NaN, and a table of NaN answers the question worse than saying so does. A
 * non-numeric argument arrives as NaN and fails in exactly the same way, and
 * zero players walks off the end of `hands` in playGame, so one test covers
 * all three.
 */
if (!Number.isInteger(games) || games < 1 || !Number.isInteger(players) || players < 1) {
  console.error(
    "usage: simulate.ts [games] [players] — both must be whole numbers of at least 1",
  );
  process.exit(1);
}

// The words file, the dictionary and its index are no longer needed on the
// main thread: each worker builds its own copy once and plays every game it
// is given against it (see scripts/sim-worker.ts).
const WORKER = new URL("./sim-worker.ts", import.meta.url);

/**
 * A pool of workers, kept alive across variants.
 *
 * Starting one per variant would pay to build the dictionary six times over.
 */
function makePool(size: number) {
  // Forward the running process's own execArgv rather than hardcoding
  // ["--import", "tsx"]: tsx is not a project dependency here, so a bare
  // "tsx" specifier doesn't resolve from a worker thread and the worker dies
  // with ERR_MODULE_NOT_FOUND before it can play a single game. This process
  // was itself launched by `npx tsx`, which already put the loader's
  // absolute --require/--import flags (pointing at npx's cache) on
  // process.execArgv -- reusing them makes each worker load TypeScript the
  // exact same way the main thread does, however tsx happened to get here.
  const workers = Array.from({ length: size }, () => new Worker(WORKER, { execArgv: process.execArgv }));

  const play = (variant: Variant, players: number, count: number) =>
    new Promise<GameResult[]>((resolve, reject) => {
      const results: GameResult[] = new Array(count);
      let next = 0;
      let done = 0;

      const give = (worker: Worker) => {
        if (next >= count) return;
        worker.postMessage({ variant, players, index: next++ });
      };

      for (const worker of workers) {
        worker.removeAllListeners("message");
        worker.removeAllListeners("error");
        worker.on("message", ({ index, result }: { index: number; result: GameResult }) => {
          results[index] = result;
          if (++done === count) resolve(results);
          else give(worker);
        });
        worker.on("error", reject);
        give(worker);
      }
    });

  return { play, close: () => Promise.all(workers.map((w) => w.terminate())) };
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

/**
 * Standard error of a per-game mean, so the table says how much of itself to
 * believe.
 *
 * Reported for the 3x3+ column because that is the column arguments get had
 * over and the one whose per-game spread is widest relative to its mean: a
 * game that closes none and a game that closes five are both ordinary. Two
 * runs differing by less than about 2 SE are not distinguishable, and without
 * this printed alongside, the difference gets read as a result anyway -- which
 * has happened. Sample standard deviation over sqrt(n); one game reports 0
 * because a single sample has no spread to measure, not because it is precise.
 */
const stderr = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance / xs.length);
};

const rows: Record<string, string>[] = [];
const pool = makePool(Math.min(cpus().length, games));

// Kept serial: this loop is where the "secs" column comes from, and running
// two variants' games concurrently would blur that number across variants.
// The parallelism lives inside pool.play, across games within one variant.
for (const variant of VARIANTS) {
  const started = Date.now();
  const results = await pool.play(variant, players, games);

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
    "3x3+ se": stderr(bigSquares).toFixed(2),
    "dry %": ((results.filter((r) => r.ranDry).length / games) * 100).toFixed(0),
    "edge gap": mean(results.map((r) => r.edgeMargin)).toFixed(1),
    secs: ((Date.now() - started) / 1000).toFixed(1),
  });
  console.error(`  ${variant.name}: done`);
}

await pool.close();

console.log(`\n${games} games, ${players} players, identical draws across variants\n`);
console.table(rows);
