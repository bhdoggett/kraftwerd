import weights from "./data/letter-weights.json" with { type: "json" };
import type { RackConfig } from "./engine/rack.js";

/**
 * Every tunable in one place, as data. These numbers are balance knobs and are
 * expected to change from real games; nothing in the engine reads them
 * directly.
 */

export const RACK: RackConfig = {
  /** 6 letters plus the blank slot, so 7 tiles are placeable per turn. */
  size: 6,
  // Derived from letter frequency in 2-5 letter dictionary words by
  // scripts/build-dictionary.mjs -- see design.md §5.1. Note S is inflated by
  // plurals; if racks feel S-heavy in play, damp it here rather than in code.
  weights,
  vowels: "AEIOU",
  /**
   * Two.
   *
   * At a floor of one, 35% of racks arrived with a single vowel and five
   * consonants, which is barely playable on a six-letter rack. Two removes
   * that case without stuffing the rack: the average only moves from 2.06 to
   * 2.41, since most racks already had two or more.
   *
   * The blank can always stand in for a vowel as well, so this is about how
   * the rack reads rather than whether a play exists at all.
   */
  minVowels: 2,
  maxDuplicates: 2,
};

export const GAME = {
  /**
   * Odd-sided, so there is a true centre for the opening word to cover. The
   * whole board is drawn, blocked squares included: they can only be planned
   * around if they can be seen.
   */
  boardSize: 15,
  /** Game ends once this many tiles are on the board (design.md §6). */
  endThreshold: 100,
  /** 1 is a solo practice game: it starts immediately with no one to wait for. */
  minPlayers: 1,
  maxPlayers: 4,
} as const;
