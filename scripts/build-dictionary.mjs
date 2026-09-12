/**
 * Build the game dictionary from two public-domain word lists, vendored in
 * `vendor/wordlists/` (see `ATTRIBUTION.md` there and design.md §5.2 for why
 * these two and not SCOWL or an official Scrabble list):
 *
 * - `enable1.txt` — ENABLE, ~172k words, a flat list with no tiering.
 * - `3of6game.txt` — from the 12dicts package, built specifically for word
 *   games rather than for a spellchecker. Carries trailing annotation
 *   characters on some entries (why the word was included), stripped below;
 *   they are provenance notes, not part of the spelling.
 *
 * Usage: node scripts/build-dictionary.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(ROOT, "vendor", "wordlists");

const words = new Set();

/** Strip an accent (a spelling detail no tile can carry) and reject anything
 * that still isn't a plain word once it's gone — punctuation, contractions,
 * hyphenated or multi-word entries, proper nouns. */
const admit = (raw) => {
  const plain = raw.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/^[a-z]+$/.test(plain)) words.add(plain.toUpperCase());
};

for (const line of readFileSync(join(VENDOR, "enable1.txt"), "utf8").split("\n")) {
  if (line) admit(line);
}

// 3of6game annotates some entries with a trailing $ + ^ & ! marking *why* the
// word was included (rare, signature, inflected, spelling-variant,
// neologism) — meaningful provenance for the compiler, not part of the word.
for (const line of readFileSync(join(VENDOR, "3of6game.txt"), "utf8").split("\n")) {
  if (line) admit(line.replace(/[$+^&!]$/, ""));
}

// Both sources list occasional one-letter entries (I, O, a bare "x"), which
// is not the same question as which one-letter *plays* are legal: a
// one-tile run is legal only if it spells something, and only A and I do.
for (const word of [...words]) if (word.length === 1) words.delete(word);
words.add("A");
words.add("I");

/**
 * The two-letter list, curated by hand.
 *
 * It is the highest-leverage file in the game: a 2x2 is four two-letter
 * words, so this list alone decides how many squares exist at all. Neither
 * source above is edited for word-game use in this specific way — ENABLE
 * omits words every word-game player expects (QI, JO, ZA, XI), and both
 * carry oddities (letter-name plurals, and similar) nobody would accept on a
 * board. Replacing their two-letter entries wholesale, rather than trusting
 * either, keeps this the one place that answers the question on purpose.
 *
 * Leaving J/Q/Z out matters especially: with no two-letter word containing
 * them, those letters could never enter a 2x2 at all.
 */
const TWO_LETTER = `
  aa ab ad ae ag ah ai al am an ar as at aw ax ay
  ba be bi bo by
  da de do
  ed ee ef eh el em en er es et ew ex
  fa fe
  gi go
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
  ya ye yo yu
  za
`
  .split(/\s+/)
  .filter(Boolean)
  .map((w) => w.toUpperCase());

for (const word of [...words]) if (word.length === 2) words.delete(word);
for (const word of TWO_LETTER) words.add(word);

/**
 * The names of the letters, and their plurals.
 *
 * Which of these survive in an ordinary word list is an accident — a BEE, to
 * SEE, a JAY and the EL train are in there because they double as ordinary
 * words, not because anyone decided letter names belong. That's a rule a
 * player runs into rather than learns. Naming all of them makes it
 * learnable: every letter has a name, and every name plays.
 *
 * Plurals in the same breath, deliberately — adding the names alone would
 * only move the arbitrary line rather than remove it.
 */
const LETTER_NAMES = `
  ${""/* EE and YU are two letters long, so they live in TWO_LETTER above:
        that list is rebuilt wholesale and would drop them from here. */}
  aitch aitches
  ar ars
  bee bees
  cee cees
  dee dees
  ees
  ef efs
  el els
  em ems
  en ens
  ess esses
  ex exes
  gee gees
  jay jays
  kay kays
  oh ohs
  pee pees
  cue cues
  tee tees
  vee vees
  wye wyes
  yus
  zed zeds
  zee zees
`
  .split(/\s+/)
  .filter(Boolean)
  .map((w) => w.toUpperCase());

for (const word of LETTER_NAMES) words.add(word);

/**
 * Words neither source lists, added by hand.
 *
 * ZEN is filed by both as a proper noun (the Buddhist school), missing the
 * lower-case sense ("very zen about it") that is the one a board can't tell
 * apart anyway. Add to this list when a game turns one up — it is cheaper
 * than a new source, and every entry here is a decision somebody made
 * rather than a side effect of one.
 */
const EXTRAS = `
  zen
`
  .split(/\s+/)
  .filter(Boolean)
  .map((w) => w.toUpperCase());

for (const word of EXTRAS) words.add(word);

/**
 * Slurs, screened out by hand.
 *
 * Neither source above is moderated for word-game use: each documents a word
 * if real dictionaries do, with no opinion on whether it belongs at a family
 * table. Some of these have an unrelated everyday sense too — CRIPPLE as a
 * verb, RETARD as in "retard growth", GRINGO used neutrally, COON short for
 * raccoon — cut anyway, since the slur sense is the one a tile on a board
 * can't explain away. PADDY and SLOPE stay: those readings are the primary,
 * everyday one.
 *
 * TRANNY is cut on the same test even though it also means "transmission" —
 * unlike PADDY/SLOPE, its slur sense reads as the primary one today, not a
 * secondary reading a board could lean on.
 *
 * Ordinary profanity is deliberately not on this list and never has been —
 * SHIT, FUCK, DAMN, HELL and the like are meant to play. This is about
 * identity-based slurs specifically, not a general profanity filter.
 *
 * Not exhaustive. Add to it when a game turns one up.
 */
const SLURS = `
  spic spics
  wop wops
  kike kikes
  chink chinks
  gook gooks
  wetback wetbacks
  dago dagos dagoes
  honky honkies
  redskin redskins
  squaw squaws
  negro
  nigger niggers
  nigga niggas niggaz
  fag fags
  faggot faggots
  cunt cunts
  mulatto mulattoes mulattos
  yid yids
  mongoloid mongoloids
  coolie coolies
  golliwog golliwogs golliwogg
  coon coons
  gringo gringos
  cripple cripples
  spastic spastics
  retard retards
  limey limeys
  tranny
`
  .split(/\s+/)
  .filter(Boolean)
  .map((w) => w.toUpperCase());

for (const word of SLURS) words.delete(word);

const sorted = [...words].sort();
const outDir = join(ROOT, "shared", "data");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "words.json"), JSON.stringify(sorted));

// JSONL for `npx convex import --table words`. The dictionary lives in a
// Convex table rather than the function bundle: this many words is far too
// much to ship inside a deployed module, and this way it can be swapped
// without a redeploy.
writeFileSync(
  join(outDir, "words.jsonl"),
  sorted.map((word) => JSON.stringify({ word })).join("\n") + "\n",
);

// Both sources ask for credit, though neither requires it as a licence
// condition. Travels with the generated data, same spot SCOWL's notice used
// to live.
copyFileSync(join(VENDOR, "ATTRIBUTION.md"), join(outDir, "WORDLIST-ATTRIBUTION.md"));

// Letter weights are not generated here. shared/data/letter-weights.json is
// hand-written from real English letter frequency (design.md §5.1) rather
// than derived from this dictionary, so it does not depend on which sources
// are built and survives a rebuild untouched.

const byLength = (n) => sorted.filter((w) => w.length === n).length;
console.log(`${sorted.length} words`);
console.log(`  2-letter: ${byLength(2)}`);
console.log(`  3-letter: ${byLength(3)}`);
console.log(`  4-letter: ${byLength(4)}`);
