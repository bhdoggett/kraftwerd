import { BOT_NAMES, type Difficulty } from "../../shared/config";

/**
 * Who is at the table besides you, while the game is still being set up.
 *
 * Friends and bots share one pool of seats, so neither can be reasoned about
 * on its own: ticking a friend has to take a seat away from the machines and
 * the other way round. Generic in the friend's id so this stays testable
 * without a database.
 */
export interface Roster<Friend = string> {
  readonly friends: readonly Friend[];
  readonly bots: readonly Difficulty[];
}

/** Seats nobody holds yet. Seat 0 is yours and never counts. */
export function seatsFree<F>(roster: Roster<F>, playerCount: number): number {
  return Math.max(0, playerCount - 1 - roster.friends.length - roster.bots.length);
}

/**
 * Cut the roster down to a smaller game.
 *
 * Bots go first: a friend is someone you picked out by name, a bot is a seat
 * filler, so when the table shrinks the filler is what should give way.
 */
export function trimRoster<F>(roster: Roster<F>, playerCount: number): Roster<F> {
  const seats = Math.max(0, playerCount - 1);
  const friends = roster.friends.slice(0, seats);
  return { friends, bots: roster.bots.slice(0, seats - friends.length) };
}

/**
 * The name the bot at this position will play under.
 *
 * The server seats bots from seat 1 upwards and names them by seat, so the
 * same arithmetic here keeps the setup screen honest — the "Sam" you added is
 * the "Sam" you end up playing.
 */
export function botLabel(index: number): string {
  return BOT_NAMES[(index + 1) % BOT_NAMES.length];
}
