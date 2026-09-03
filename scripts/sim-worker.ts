/**
 * One game, played off the main thread.
 *
 * The dictionary and its index are built once per worker and reused for every
 * game that worker is given -- building them per game would cost more than
 * the games do.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parentPort } from "node:worker_threads";
import { makeDictionary } from "../shared/engine/dictionary.ts";
import { indexWords, type Difficulty } from "../shared/sim/bot.ts";
import { playGame } from "../shared/sim/game.ts";
import type { Variant } from "../shared/sim/variants.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
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

// The pool hands out tasks by game index, never by variant. The seed below
// is keyed on that index alone -- task.index + 1, exactly what the serial
// loop used -- so every variant meets the same bags in the same order
// regardless of which worker happens to draw which game, or in what order
// workers finish. Reintroducing any variant-dependent term here (e.g.
// mixing in a variant id or a per-worker counter) would silently break the
// "identical draws across variants" guarantee the simulator's whole
// comparative method depends on. The difficulties and chain shape below are
// no exception: they are passed to playGame and never to the seed.
parentPort!.on(
  "message",
  (task: {
    variant: Variant;
    players: number;
    index: number;
    difficulties: readonly Difficulty[];
    chain?: { depth: number; breadth: number };
  }) => {
    const result = playGame(
      task.variant,
      task.players,
      dictionary,
      index,
      seeded(task.index + 1),
      task.difficulties,
      task.chain,
    );
    parentPort!.postMessage({ index: task.index, result });
  },
);
