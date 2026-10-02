/**
 * Names for the players nobody chose: the machines, and the people hiding
 * behind an alias in a public game.
 *
 * One pool for both, because two pools kept the kinds apart only by
 * convention -- "Sigurd" and "Robin" both read as a person's name -- and a
 * convention cannot be relied on by somebody reading a scoreboard. A
 * machine's level in brackets can, so the level does that job and the pool
 * does not. (A `Robo-` prefix did it until it was dropped: it put the same
 * five letters in front of every machine, and the part that told two apart
 * came last.)
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
  "Sundiata", "Sogolon", "Fakoli", "Kolonkan",
  "Silamaka", "Poullori", "Nare", "Balla",
  // East Asian folklore
  "Mulan", "Momotaro", "Kintaro", "Urashima", "Gildong",
  "Chunhyang", "Ondal", "Benkei", "Tomoe", "Issun",
  // Beowulf and Old English
  "Wiglaf", "Hrothgar", "Unferth", "Scyld", "Hygelac", "Hildeburh",
] as const;

/**
 * What used to mark a machine's name. Machines made before it was dropped
 * still carry it in their stored name, so it is taken off when they are shown
 * (`asShown`).
 */
export const ROBOT_PREFIX = "Robo-";

/**
 * `count` names, drawn at random and never repeating.
 *
 * `taken` is for filling a table in stages -- the players already named keep
 * the names they were given, and this only picks the new ones. One draw
 * serves a whole game, so a machine and an aliased person can never end up
 * under the same name.
 *
 * The rng is passed in, so a test can pin a draw.
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

/** A name without the level a machine's carries, for where the level is noise. */
export function withoutLevel(name: string): string {
  return name.replace(/ \((?:easy|medium|hard)\)$/, "");
}

/** What a machine plays under: its name, and how good it is. */
export function robotName(name: string, level: string): string {
  return `${name} (${level})`;
}

/** A machine's stored name as it is shown, without the prefix older ones carry. */
export function asShown(name: string): string {
  return name.startsWith(ROBOT_PREFIX) ? name.slice(ROBOT_PREFIX.length) : name;
}

/** How long a chosen display name may be, after trimming. */
export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 24;

/**
 * A display name as a player typed it, tidied, or why it cannot be one.
 *
 * Shared so the form can say what is wrong before the server does. No `@`,
 * because the point of choosing a name is to stop showing an email address.
 * No brackets, so nobody can dress up as a machine with a level after it.
 */
export function checkDisplayName(
  raw: string,
): { ok: true; name: string } | { ok: false; reason: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < DISPLAY_NAME_MIN) {
    return { ok: false, reason: `At least ${DISPLAY_NAME_MIN} characters` };
  }
  if (name.length > DISPLAY_NAME_MAX) {
    return { ok: false, reason: `At most ${DISPLAY_NAME_MAX} characters` };
  }
  if (name.includes("@")) {
    return { ok: false, reason: "No email addresses" };
  }
  if (!/^[\p{L}\p{N} .'_-]+$/u.test(name)) {
    return { ok: false, reason: "Letters, numbers, spaces and . ' _ - only" };
  }
  return { ok: true, name };
}
