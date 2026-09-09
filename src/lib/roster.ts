import { BOT_NAMES, GAME } from "../../shared/config";

/**
 * Filling the seats at a table that is still being set up.
 *
 * A game is either people or machines, never both, so there is no shared pool
 * of seats to reason about: a table of machines is as many as you asked for,
 * and a table of people is you plus whoever you picked plus the seats you are
 * holding open for a link. What is left here is the arithmetic of the second
 * and the naming of the first.
 */

/**
 * Names for `count` machines, drawn at random and never repeating.
 *
 * The draw happens where the game is set up rather than where it is seated,
 * because the setup screen shows the names: a server that drew its own would
 * name the opponent you agreed to something else. `taken` is for growing a
 * table — the machines already on screen keep the names they were given, and
 * this only picks the new ones.
 *
 * The rng is passed in the way `gameName` takes one, so a test can pin a draw.
 */
export function drawBotNames(
  count: number,
  rng: () => number,
  taken: Iterable<string> = [],
): string[] {
  const spoken = new Set(taken);
  const pool = BOT_NAMES.filter((name) => !spoken.has(name));

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

/**
 * Seats a table of people has spare.
 *
 * `picked` are the friends ticked, `open` the seats deliberately left for an
 * invite link. Your own seat is never spare.
 */
export function seatsSpare(picked: number, open: number): number {
  return Math.max(0, GAME.maxPlayers - 1 - picked - open);
}
