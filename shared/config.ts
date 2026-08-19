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
   * One, not two or three.
   *
   * The blank can always stand in for a vowel, so a high floor mostly served
   * to guarantee spare vowels rather than playability. Dropping to 1 takes
   * "can build a 2x2 without spending the blank" from 82% to 55%, which makes
   * the blank a real decision instead of a spare tile, while a vowel-less rack
   * remains vanishingly rare at this size.
   */
  minVowels: 1,
  maxDuplicates: 2,
};

export const GAME = {
  /**
   * Board is square. Only the played area and its edge are ever rendered
   * (see Board.tsx), so this is a bound rather than something drawn -- big
   * enough that a game never feels walled in.
   */
  boardSize: 256,
  /** Game ends once this many tiles are on the board (design.md §6). */
  endThreshold: 100,
  /** 1 is a solo practice game: it starts immediately with no one to wait for. */
  minPlayers: 1,
  maxPlayers: 4,
} as const;
