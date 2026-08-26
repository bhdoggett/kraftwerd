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

const cut = Number(process.argv[2] ?? 60);
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
    // An accent is a spelling detail no tile can carry, not a reason to drop
    // an ordinary word: CAFE and CLICHE play as themselves, accent mark or
    // not. Stripped first, so this still rejects what accent-stripping can't
    // fix -- punctuation, contractions ("don't"), and the capitals on proper
    // nouns and abbreviations (OK, dB, pH).
    const plain = word.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (/^[a-z]+$/.test(plain)) words.add(plain.toUpperCase());
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
  paver pavers
`
  .split(/\s+/)
  .filter(Boolean)
  .map((w) => w.toUpperCase());

/**
 * The names of the letters, and their plurals.
 *
 * SCOWL carries some of these already, but only where they double as ordinary
 * words: a BEE, to SEE, a JAY, the EL train, EM and EN from typography. Which
 * ones survive is therefore an accident, and an accident a player runs into —
 * EM plays and ESS does not, ELLS plays and ELS does not, with no way to guess
 * which. Naming all of them makes the rule learnable: every letter has a name,
 * and every name plays.
 *
 * Plurals in the same breath, deliberately. Adding the names alone would only
 * move the arbitrary line rather than remove it.
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

for (const word of [...EXTRAS, ...LETTER_NAMES]) words.add(word);

// Replace SCOWL's two-letter entries wholesale rather than merging, so the
// junk goes and the list is exactly what is written above.
for (const word of [...words]) if (word.length === 2) words.delete(word);
for (const word of TWO_LETTER) words.add(word);

/**
 * Slurs, screened out by hand.
 *
 * SCOWL is a spellchecker lexicon: it documents a word if a dictionary does,
 * with no opinion on whether it belongs at a family table. Some of these have
 * an unrelated everyday sense too — CRIPPLE as a verb, RETARD as in "retard
 * growth", GRINGO used neutrally, COON short for raccoon — cut anyway, since
 * the slur sense is the one a tile on a board can't explain away. PADDY and
 * SLOPE stay: those readings are the primary, everyday one.
 *
 * Not exhaustive, and not a stand-in for a full profanity filter — this is
 * about identity-based slurs specifically. Add to it when a game turns one up.
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
  nigga niggas
  fag fags
  faggot faggots
  cunt cunts
  mulatto mulattoes
  yid yids
  mongoloid mongoloids
  coolie coolies
  golliwog golliwogs
  coon coons
  gringo gringos
  cripple cripples
  spastic spastics
  retard retards
  limey limeys
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
// Convex table rather than the function bundle: 59k words is far too much to
// ship inside a deployed module, and this way it can be swapped without a
// redeploy.
writeFileSync(
  join(outDir, "words.jsonl"),
  sorted.map((word) => JSON.stringify({ word })).join("\n") + "\n",
);

// SCOWL's licence requires its copyright notice to travel with the words.
copyFileSync(join(SCOWL, "Copyright"), join(outDir, "SCOWL-Copyright.txt"));

// Letter weights are not generated here. shared/data/letter-weights.json is
// hand-written from real English letter frequency (design.md §5.1) rather
// than derived from this dictionary, so it does not depend on which tier is
// built and survives a rebuild untouched.

const byLength = (n) => sorted.filter((w) => w.length === n).length;
console.log(`tier ${cut}: ${sorted.length} words`);
console.log(`  2-letter: ${byLength(2)}`);
console.log(`  3-letter: ${byLength(3)}`);
console.log(`  4-letter: ${byLength(4)}`);
