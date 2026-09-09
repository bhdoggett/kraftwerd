/**
 * Names for the players nobody chose: the machines, and the people hiding
 * behind an alias in a public game.
 *
 * One pool for both, because two pools kept the kinds apart only by
 * convention -- "Sigurd" and "Robin" both read as a person's name -- and a
 * convention cannot be relied on by somebody reading a scoreboard. The
 * `Robo-` prefix can, so the prefix does that job and the pool does not.
 *
 * Every name is one word and a mortal person from legend: no deities, no fae,
 * no animal tricksters, and nothing from a living faith. Sources are public
 * domain and heroic rather than devotional -- an anonymous handle in a word
 * game is not a place to put somebody's god.
 */
export const NAMES = [
  // Arthurian
  "Gawain", "Bedivere", "Percival", "Igraine", "Morgause",
  "Tristan", "Isolde", "Lancelot", "Guinevere", "Galahad",
  // Norse sagas
  "Sigurd", "Gudrun", "Egil", "Ragnar", "Lagertha", "Gunnar",
  "Signy", "Grettir", "Hervor", "Aslaug", "Njal", "Hogni",
  // Shahnameh
  "Rostam", "Zal", "Tahmineh", "Sohrab", "Siyavash",
  "Rudabeh", "Manijeh", "Bijan", "Kaveh", "Gordafarid",
  // West and Central African epic
  "Sundiata", "Sogolon", "Fakoli", "Mwindo",
  "Silamaka", "Kambili", "Lianja", "Balla",
  // East Asian folklore
  "Mulan", "Momotaro", "Kintaro", "Urashima", "Gildong",
  "Chunhyang", "Ondal", "Benkei", "Tomoe", "Issun",
  // Beowulf and Old English
  "Wiglaf", "Hrothgar", "Unferth", "Scyld", "Hygelac", "Hildeburh",
] as const;

/** What marks a seat as a machine rather than a person. */
export const ROBOT_PREFIX = "Robo-";

/**
 * `count` names, drawn at random and never repeating.
 *
 * `taken` is for filling a table in stages -- the players already named keep
 * the names they were given, and this only picks the new ones. One draw
 * serves a whole game, so a machine and an aliased person can never end up
 * under the same name.
 *
 * The rng is passed in the way `gameName` takes one, so a test can pin a draw.
 */
export function drawNames(
  count: number,
  rng: () => number,
  taken: Iterable<string> = [],
): string[] {
  const spoken = new Set(taken);
  const pool = NAMES.filter((name) => !spoken.has(name));

  // Partial Fisher-Yates: swap a random survivor into each position in turn,
  // which draws without replacement however many are asked for.
  const drawn: string[] = [];
  for (let i = 0; i < pool.length && drawn.length < count; i++) {
    const pick = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[pick]] = [pool[pick], pool[i]];
    drawn.push(pool[i]);
  }
  return drawn;
}

/** What a machine plays under: the prefix says what it is, the level how good. */
export function robotName(name: string, level: string): string {
  return `${ROBOT_PREFIX}${name} (${level})`;
}
