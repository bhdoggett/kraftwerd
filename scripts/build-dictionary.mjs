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

/**
 * Which lists to read.
 *
 * `english-words` holds only the spellings both sides of the Atlantic agree
 * on, so on its own it has neither COLOR nor COLOUR — and no MATH, which is
 * filed as American. Reading the variant lists alongside it is what makes
 * both spellings playable, which is how a word game has to work.
 *
 * American only, for now: British spellings would roughly double the variant
 * words and mean COLOUR and CENTRE are playable at a table where nobody
 * writes them.
 */
const VARIANTS = ["english", "american"];

const words = new Set();
for (const tier of TIERS.filter((t) => t <= cut)) {
  const files = VARIANTS.map((v) => join(SCOWL, `${v}-words-${tier}.json`));
  for (const word of files.flatMap((file) => JSON.parse(readFileSync(file, "utf8")))) {
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

/**
 * The two-letter list, curated by hand.
 *
 * It is the highest-leverage file in the game: a 2x2 is four two-letter words,
 * so this list alone decides how many squares exist at all. SCOWL is a
 * spellchecker lexicon and is wrong for the job in both directions -- it omits
 * words every word-game player expects (QI, JO, ZA, XI) while including
 * plurals of letter names (CS, GS, TS) that nobody would accept on a board.
 *
 * Leaving J/Q/Z out matters especially: with no two-letter word containing
 * them, those letters could never enter a 2x2 at all.
 */
const TWO_LETTER = `
  aa ab ad ae ag ah ai al am an ar as at aw ax ay
  ba be bi bo by
  da de do
  ed ef eh el em en er es et ex
  fa fe
  go
  ha he hi hm ho
  id if in is it
  jo
  ka ki
  la li lo
  ma me mi mm mo mu my
  na ne no nu
  od oe of oh oi ok om on op or os ow ox oy
  pa pe pi po
  qi
  re
  sh si so
  ta te ti to
  uh um un up us ut
  we wo
  xi xu
  ya ye yo
  za
`
  .split(/\s+/)
  .filter(Boolean)
  .map((w) => w.toUpperCase());

/**
 * Words the tier misses, added by hand.
 *
 * SCOWL's tiers are about how obscure a word is to a spellchecker, which is
 * not the same question as whether a family will argue about it. MAGE sits at
 * tier 60, and taking the whole of that tier to reach it would add fifteen
 * thousand words including BOD, BUBS and DRAT. GREY and DONUT are in no tier
 * at all — one is filed as British, the other is a spelling SCOWL declines to
 * have an opinion about.
 *
 * Add to this list when a game turns one up. It is cheaper than a tier, and
 * every entry is a decision somebody made rather than a side effect.
 */
const EXTRAS = `
  mage mages
  grey greys greyer greyest
  donut donuts
  zen
`
  .split(/\s+/)
  .filter(Boolean)
  .map((w) => w.toUpperCase());

for (const word of EXTRAS) words.add(word);

// Replace SCOWL's two-letter entries wholesale rather than merging, so the
// junk goes and the list is exactly what is written above.
for (const word of [...words]) if (word.length === 2) words.delete(word);
for (const word of TWO_LETTER) words.add(word);

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

/**
 * Floor for any single letter, per 10,000.
 *
 * Raw short-word frequency puts J/Q/X/Z near 1.4% combined, so a player can go
 * a dozen racks without meeting one and every turn plays much like the last.
 * At this floor they turn up in roughly a third of racks, which is often
 * enough to be interesting without crowding out the letters that build words.
 *
 * Measured at 150: racks holding a J/Q/X/Z rise from 8% to 28%, every rack can
 * still spell a short word, and the vowel share is unchanged at 45.9%.
 */
const RARE_FLOOR = 150;

const weights = {};
for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
  const raw = Math.round(((counts[letter] ?? 0) / totalLetters) * 10_000);
  weights[letter] = Math.max(RARE_FLOOR, raw);
}
writeFileSync(join(outDir, "letter-weights.json"), JSON.stringify(weights, null, 2) + "\n");

const byLength = (n) => sorted.filter((w) => w.length === n).length;
console.log(`tier ${cut}: ${sorted.length} words`);
console.log(`  2-letter: ${byLength(2)}`);
console.log(`  3-letter: ${byLength(3)}`);
console.log(`  4-letter: ${byLength(4)}`);
