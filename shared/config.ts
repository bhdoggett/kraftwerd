import weights from "./data/letter-weights.json" with { type: "json" };
import type { RackConfig } from "./engine/rack.js";

/**
 * Every tunable in one place, as data. These numbers are balance knobs and are
 * expected to change from real games; nothing in the engine reads them
 * directly.
 */

export const RACK: RackConfig = {
  /** Letters held at the start of a turn, refilled after every play. */
  size: 7,
  // Real English letter frequency, out of a 50-letter pool, nudged toward
  // letters that are good at turning one word into another by swapping a
  // single tile -- see design.md §5.1. Hand-written in
  // shared/data/letter-weights.json, not generated, so it survives a
  // dictionary rebuild untouched.
  weights,
  vowels: "AEIOU",
  /**
   * Two. At a floor of one, a third of racks arrived with a single vowel,
   * which is barely playable. The blank can also stand in for a vowel, so this
   * is about how a rack reads rather than whether a play exists.
   */
  minVowels: 2,
  maxDuplicates: 2,
};

/**
 * Blanks are a whole-game allowance rather than a per-turn one: three each,
 * and once spent they are gone. That makes each one a decision about when to
 * spend it rather than something to use or waste every turn.
 */
export const BLANKS_PER_GAME = 3;

/**
 * How long an invite link works for. Long enough to sit in a message over a
 * weekend, short enough that a link forwarded on, or found in an old thread,
 * stops working on its own.
 */
export const FRIEND_LINK_DAYS = 7;

export const GAME = {
  /**
   * Odd-sided, so there is a true centre for the opening word to cover.
   *
   * The board is open: the drawn layouts in shared/boards.ts are kept, and the
   * rules still understand blocked squares, but no new game is dealt one.
   */
  boardSize: 15,
  /** Game ends once this many tiles are on the board (design.md §6). */
  endThreshold: 50,
  /** 1 is a solo practice game: it starts immediately with no one to wait for. */
  minPlayers: 1,
  maxPlayers: 4,
} as const;
