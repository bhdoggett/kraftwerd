/**
 * A finite pool of tiles, for asking what changes when letters run out.
 *
 * The game draws from an endless weighted stream today: every rack is
 * independent, so a board can hold four Zs and the pool is none the poorer.
 * A bag makes letters a shared, dwindling resource — which is a different
 * game, not obviously a better one, so it lives here until measured.
 */

export type Bag = Map<string, number>;

/**
 * Turn draw weights into tile counts totalling `tiles`.
 *
 * Anything with weight gets at least one tile: rounding a rare letter to zero
 * would quietly remove it from the game, which is a balance decision rather
 * than an arithmetic one.
 */
export function bagFromWeights(
  weights: Readonly<Record<string, number>>,
  tiles: number,
): Bag {
  const playable = Object.entries(weights).filter(([, w]) => w > 0);
  const total = playable.reduce((sum, [, w]) => sum + w, 0);

  const bag: Bag = new Map(
    playable.map(([letter, w]) => [letter, Math.max(1, Math.round((w / total) * tiles))]),
  );

  // Rounding up the rare letters overshoots; take the difference off the
  // commonest ones, which is where a tile either way matters least.
  let over = tilesLeft(bag) - tiles;
  const commonest = [...bag.keys()].sort((a, b) => weights[b]! - weights[a]!);
  for (const letter of commonest) {
    if (over <= 0) break;
    const held = bag.get(letter)!;
    const take = Math.min(over, held - 1);
    bag.set(letter, held - take);
    over -= take;
  }

  return bag;
}

export function tilesLeft(bag: Bag): number {
  let n = 0;
  for (const count of bag.values()) n += count;
  return n;
}

/** Take up to `count` tiles, each equally likely. Mutates the bag. */
export function draw(bag: Bag, count: number, rng: () => number): string[] {
  const taken: string[] = [];

  for (let i = 0; i < count; i++) {
    const left = tilesLeft(bag);
    if (left === 0) break;

    let roll = Math.floor(rng() * left);
    for (const [letter, held] of bag) {
      roll -= held;
      if (roll < 0) {
        bag.set(letter, held - 1);
        if (held - 1 === 0) bag.delete(letter);
        taken.push(letter);
        break;
      }
    }
  }

  return taken;
}

/**
 * Two of everything, one of each hard letter.
 *
 * A different theory of a bag from `bagFromWeights`: rather than mirroring how
 * often letters appear in English, give the alphabet an almost flat spread so
 * every letter is a live possibility and the hard ones are genuinely scarce.
 * With 22 ordinary letters that lands at 48 tiles, near the game's end
 * threshold, so the bag runs out at about the moment the game does.
 */
export function bagFlat(hard = "JQXZ", pairs = 2, singles = 1): Bag {
  const bag: Bag = new Map();
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    bag.set(letter, hard.includes(letter) ? singles : pairs);
  }
  return bag;
}
