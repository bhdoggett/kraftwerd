import type { RackConfig } from "./rack.js";

/**
 * A finite supply of tiles, shared by everyone at the table.
 *
 * The weights used to describe an endless draw: every rack was an independent
 * lottery, so a Z was two per cent of every tile anyone ever drew and four
 * people could hold one at once. Read as a bag, the same numbers mean what
 * they look like — one Z exists, and once it is played it is gone.
 *
 * Kept as counts rather than a shuffled list: a list would have to be stored
 * in order, which is the whole future of the game written down where a bug
 * could read it.
 */
export type Bag = Record<string, number>;

export function newBag(config: RackConfig): Bag {
  const bag: Bag = {};
  for (const [letter, count] of Object.entries(config.weights)) {
    if (count > 0) bag[letter] = count;
  }
  return bag;
}

export function tilesLeft(bag: Bag): number {
  let n = 0;
  for (const count of Object.values(bag)) n += count;
  return n;
}

/**
 * Take up to `count` tiles, each remaining tile equally likely.
 *
 * Returns a new bag rather than mutating: the caller writes it back in the
 * same transaction as the rack it filled, so the two cannot disagree.
 */
export function draw(
  bag: Bag,
  count: number,
  rng: () => number,
): { drawn: string[]; bag: Bag } {
  const left: Bag = { ...bag };
  const drawn: string[] = [];

  for (let i = 0; i < count; i++) {
    const total = tilesLeft(left);
    if (total === 0) break;

    let roll = Math.floor(rng() * total);
    for (const [letter, held] of Object.entries(left)) {
      roll -= held;
      if (roll < 0) {
        if (held === 1) delete left[letter];
        else left[letter] = held - 1;
        drawn.push(letter);
        break;
      }
    }
  }

  return { drawn, bag: left };
}

/** Put tiles back, as a trade does. */
export function returnTiles(bag: Bag, letters: readonly string[]): Bag {
  const next: Bag = { ...bag };
  for (const letter of letters) next[letter] = (next[letter] ?? 0) + 1;
  return next;
}
