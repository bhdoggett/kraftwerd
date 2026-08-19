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
  // Short words run ~35% vowels, so 6 letters average ~2.1. The floor stops
  // the all-consonant racks that independent draws otherwise produce; at 3 it
  // would force over half a 6-letter rack to be vowels, so 2 it is.
  minVowels: 2,
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
