/**
 * Build the game dictionary from SCOWL (via the wordlist-english package).
 *
 * SCOWL is tiered by word commonality: tier 10 is the most common words, tier
 * 70 includes obscure ones. Tiers are additive, so a cut of N means "every
 * tier up to and including N".
 *
 * Usage: node scripts/build-dictionary.mjs [tier]
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCOWL = join(ROOT, "node_modules", "wordlist-english");
const TIERS = [10, 20, 35, 40, 50, 55, 60, 70];

const cut = Number(process.argv[2] ?? 50);
if (!TIERS.includes(cut)) {
  console.error(`tier must be one of ${TIERS.join(", ")}`);
  process.exit(1);
}

const words = new Set();
for (const tier of TIERS.filter((t) => t <= cut)) {
  const file = join(SCOWL, `english-words-${tier}.json`);
  for (const word of JSON.parse(readFileSync(file, "utf8"))) {
    // Drop anything with punctuation, accents, or capitals: proper nouns,
    // contractions ("don't"), and abbreviations are not playable tiles.
    if (/^[a-z]+$/.test(word)) words.add(word.toUpperCase());
  }
}

// SCOWL lists every letter of the alphabet as a one-letter "word" -- that is a
// spellchecker artifact (single letters are valid tokens), not English. Only A
// and I are real words, and the distinction matters: a one-tile run is legal
// only if it spells something.
for (const letter of "BCDEFGHJKLMNOPQRSTUVWXYZ") words.delete(letter);

const sorted = [...words].sort();
const outDir = join(ROOT, "shared", "data");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "words.json"), JSON.stringify(sorted));

// JSONL for `npx convex import --table words`. The dictionary lives in a
// Convex table rather than the function bundle: 59k words is far too much to
// ship inside a deployed module, and this way it can be swapped without a
// redeploy.
writeFileSync(
  join(outDir, "words.jsonl"),
  sorted.map((word) => JSON.stringify({ word })).join("\n") + "\n",
);

// SCOWL's licence requires its copyright notice to travel with the words.
copyFileSync(join(SCOWL, "Copyright"), join(outDir, "SCOWL-Copyright.txt"));

// Letter weights, derived from how often each letter appears in SHORT words
// (2-5 letters) rather than in English prose. Prose frequency is the wrong
// prior here: what matters is the letters that actually build the small words
// a word square is made of. J/Q/V/Z fall out near zero on their own, so they
// need no special suppression -- they stay playable in longer words.
const short = sorted.filter((w) => w.length >= 2 && w.length <= 5);
const counts = {};
let totalLetters = 0;
for (const word of short) {
  for (const ch of word) {
    counts[ch] = (counts[ch] ?? 0) + 1;
    totalLetters++;
  }
}

const weights = {};
for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
  // per-10,000, rounded, floored at 1 so no letter is unreachable
  weights[letter] = Math.max(1, Math.round(((counts[letter] ?? 0) / totalLetters) * 10_000));
}
writeFileSync(join(outDir, "letter-weights.json"), JSON.stringify(weights, null, 2) + "\n");

const byLength = (n) => sorted.filter((w) => w.length === n).length;
console.log(`tier ${cut}: ${sorted.length} words`);
console.log(`  2-letter: ${byLength(2)}`);
console.log(`  3-letter: ${byLength(3)}`);
console.log(`  4-letter: ${byLength(4)}`);
