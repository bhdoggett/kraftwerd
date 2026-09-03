/**
 * Play a lot of games, so a rules change can be argued about with numbers.
 *
 * Usage: node scripts/simulate.ts [games] [players] [filter] [difficulty] [chain]
 *
 * The filter is a substring of a variant's name, and exists because the six
 * variants are six full sweeps: on eight cores, 200 games of all six is the
 * better part of an hour, while the one row design.md §6 quotes is eight
 * minutes. Seeds are keyed on the game index alone (see sim-worker.ts), so a
 * filtered run plays exactly the games an unfiltered one would have played for
 * that variant, and the row it prints is the row the full sweep would print.
 *
 * The difficulty is what the bots play at, `hard` by default, and it is a
 * comma-separated list read seat by seat: `easy` seats every player at easy,
 * `hard,easy` puts a hard bot in seat 0 against an easy one in seat 1. It is
 * not part of any seed, so the same game index meets the same bag at every
 * difficulty; what differs is which of the moves on offer gets played.
 *
 * The chain argument is `depth,breadth` or `depth,breadth,enablement` -- how
 * many separate plays a turn may be built from, how many candidates each step
 * branches on, and optionally how much a point of what a link LEAVES is worth
 * against a point of what it scores when choosing which to build on. Omitted,
 * branching is by score alone. Omitted entirely, the
 * search picks its own default, which is what every figure in design.md §6
 * was measured at; pass one and the run is no longer comparable with that
 * table except against another run at the same shape. Cost is roughly
 * geometric in breadth, so depth 3 is not a small ask: see the note above the
 * knobs in convex/bots.ts.
 */
import { cpus } from "node:os";
import { Worker } from "node:worker_threads";
import { type GameResult } from "../shared/sim/game.ts";
import type { Difficulty } from "../shared/sim/bot.ts";
import type { Variant } from "../shared/sim/variants.ts";
import { DIFFICULTIES, RACK } from "../shared/config.ts";

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

  const play = (
    variant: Variant,
    players: number,
    count: number,
    difficulties: readonly Difficulty[],
    chain?: { depth: number; breadth: number; enablement?: number },
  ) =>
    new Promise<GameResult[]>((resolve, reject) => {
      const results: GameResult[] = new Array(count);
      let next = 0;
      let done = 0;

      const give = (worker: Worker) => {
        if (next >= count) return;
        worker.postMessage({ variant, players, index: next++, difficulties, chain });
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
// Derived, not written down: `makeBag` ignores `bag` whenever `weights` is
// given and uses the counts exactly, so a literal here is a number nothing
// checks -- which is how the row came to be labelled fifty tiles while holding
// seventy-one. Non-null is the part that matters; it means "a finite bag".
const CURRENT_TILES = Object.values(CURRENT).reduce((a, b) => a + b, 0);

const VARIANTS: Variant[] = [
  /*
   * The shipped bag, whatever it currently is, and so the row every other row
   * is read against. Named rather than described: `weights` is the hand-written
   * file, `makeBag` in game.ts uses those contents exactly and ignores `bag`
   * when they are given, and this row was labelled "50 / 26% vowels" for long
   * enough after the bag became seventy-one tiles at 38% that the figure was
   * copied into design.md §6 as a statement about the current rules. The line
   * printed above the table has the real composition, computed.
   */
  { name: "now: the shipped bag", bag: CURRENT_TILES, multiplier: "none", weights: CURRENT },
  { name: "50 / 33%", bag: 50, multiplier: "none", weights: makeBag(50, 0.33) },
  { name: "50 / 42%", bag: 50, multiplier: "none", weights: makeBag(50, 0.42) },
  { name: "62 / 26%", bag: 62, multiplier: "none", weights: makeBag(62, 0.26) },
  { name: "62 / 33%", bag: 62, multiplier: "none", weights: makeBag(62, 0.33) },
  { name: "62 / 42%", bag: 62, multiplier: "none", weights: makeBag(62, 0.42) },
];

/*
 * What the bots play at, seat by seat.
 *
 * Refused rather than defaulted on a typo: `nightmare` silently becoming
 * `hard` would print a table labelled with a difficulty it did not measure,
 * and the whole point of the argument is that the label is true.
 */
const DIFFICULTIES_ARG = (process.argv[5] ?? "hard").split(",").map((s) => s.trim());
const bad = DIFFICULTIES_ARG.filter((d) => !(DIFFICULTIES as readonly string[]).includes(d));
if (bad.length > 0) {
  console.error(
    `unknown difficulty ${bad.map((d) => JSON.stringify(d)).join(", ")} — have: ` +
      DIFFICULTIES.join(", "),
  );
  process.exit(1);
}
const LEVELS = DIFFICULTIES_ARG as Difficulty[];

/*
 * The chain shape, `depth,breadth`, or undefined to let the search choose.
 *
 * Undefined rather than a literal default on purpose: the default lives in
 * `rank`, and copying it here would be a second place to change and a second
 * place to be wrong about what design.md §6 was measured at.
 *
 * Refused rather than defaulted on a bad value, for the same reason the
 * difficulty is: a run labelled with a shape it did not play is worse than no
 * run. Depth 1 is legal and means the single-span search, i.e. no chaining.
 */
const CHAIN_ARG = process.argv[6];
let CHAIN: { depth: number; breadth: number; enablement?: number } | undefined;
if (CHAIN_ARG !== undefined) {
  const parts = CHAIN_ARG.split(",").map((s) => Number(s.trim()));
  const [d, b, e] = parts;
  const bad =
    (parts.length !== 2 && parts.length !== 3) ||
    d === undefined || b === undefined ||
    !Number.isInteger(d) || !Number.isInteger(b) || d < 1 || b < 1 ||
    // The third is a weight, not a count: any finite number, sign included.
    (parts.length === 3 && (e === undefined || !Number.isFinite(e)));
  if (bad) {
    console.error(
      `chain must be "depth,breadth" or "depth,breadth,enablement" — depth and ` +
        `breadth integers >= 1, enablement any finite number — got ` +
        JSON.stringify(CHAIN_ARG),
    );
    process.exit(1);
  }
  CHAIN = parts.length === 3 ? { depth: d!, breadth: b!, enablement: e } : { depth: d!, breadth: b! };
}

const filter = process.argv[4];
const CHOSEN = filter === undefined
  ? VARIANTS
  : VARIANTS.filter((v) => v.name.includes(filter));

// A filter matching nothing would otherwise print an empty table and read as
// "the variants are all identical" rather than "you typed the name wrong".
if (CHOSEN.length === 0) {
  console.error(
    `no variant name contains ${JSON.stringify(filter)} — have: ` +
      VARIANTS.map((v) => JSON.stringify(v.name)).join(", "),
  );
  process.exit(1);
}

for (const v of CHOSEN) {
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
 * game that closes none and a game that closes five are both ordinary.
 *
 * This is the error of *one* mean. Telling two runs apart takes the error of
 * their difference, which carries both: sqrt(2) x SE, so the threshold is
 * about 2.8 x the number printed here, not 2 x it. Pairing the runs by seed
 * would beat that, but this computes per-game means and never per-game
 * differences, so the paired figure is not available and the unpaired one is
 * what the column supports.
 *
 * Sample standard deviation over sqrt(n); one game reports 0 because a single
 * sample has no spread to measure, not because it is precise.
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
for (const variant of CHOSEN) {
  const started = Date.now();
  const results = await pool.play(variant, players, games, LEVELS, CHAIN);

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

// "Identical draws" is the claim that makes the rows comparable, so it is only
// printed when there are rows to compare; on a filtered run it would be a
// guarantee about nothing.
// Seat by seat rather than as the argument was typed: one entry seats every
// player, so echoing "easy" back would not say how many easy bots played.
const seating = Array.from(
  { length: players },
  (_, i) => `seat ${i} ${LEVELS[i % LEVELS.length]!}`,
).join(", ");

console.log(
  `\n${games} games, ${players} players, ${seating}` +
    (CHAIN === undefined
      ? ""
      : `, chain depth ${CHAIN.depth} breadth ${CHAIN.breadth}` +
        (CHAIN.enablement === undefined ? "" : ` enablement ${CHAIN.enablement}`)) +
    (CHOSEN.length > 1 ? ", identical draws across variants" : "") +
    "\n",
);
console.table(rows);
