import { GAME } from "../../shared/config";

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
 * Seats a table of people has spare.
 *
 * `picked` are the friends ticked, `open` the seats deliberately left for an
 * invite link. Your own seat is never spare.
 */
export function seatsSpare(picked: number, open: number): number {
  return Math.max(0, GAME.maxPlayers - 1 - picked - open);
}
