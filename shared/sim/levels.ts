/**
 * What each difficulty is allowed to know and to look for.
 *
 * The bands in bot.ts decide how good a move a level settles for out of the
 * moves it can see. This decides which moves it can see at all, and it is
 * the larger lever: a band only turns a strong search down, and a strong
 * search against a person mostly wins on two things no person has -- every
 * obscure three-letter word, and an exhaustive hunt for the last tiles of a
 * 3x3. Measured in the simulator before these existed, two hard bots
 * completed eight 3x3s a game between them.
 *
 * Shared by the live bot (convex/bots.ts) and the simulator
 * (shared/sim/game.ts), so a level measured in one is the level played in the
 * other.
 */
import type { Difficulty } from "../config.js";
import type { Dictionary } from "../engine/legality.js";
import { BLOCK_DEFAULTS, type BlockOptions } from "./blocks.js";
import type { WordIndex } from "./words.js";

/**
 * Which words a bot may play.
 *
 * `full` is the game's own dictionary. `common` is
 * shared/data/common-words.json: 3of6game's everyday entries (everything not
 * marked rare), with the curated two-letter list and the letter names kept
 * whole -- see scripts/build-dictionary.mjs. Only what the bot looks for is
 * limited; the game still checks everything against the full list, and a
 * person playing an easy bot may play any word they like.
 */
export type Vocabulary = "common" | "full";

/** A dictionary to check words against and an index to search, built from
 * one word list, so a bot never forms a crossing word it could not have
 * looked for. */
export interface Lexicon {
  dictionary: Dictionary;
  words: WordIndex;
}

interface Level {
  vocabulary: Vocabulary;
  /**
   * The dedicated square search, `blockMoves` and `blankMoves` both. Zero
   * `maxBlocks` switches both off: the span and chain searches can still close
   * a square when one falls out of an ordinary word, but nothing goes looking,
   * and no blank is ever spent, since the square search is the only place a
   * live bot is offered one.
   */
  squares: BlockOptions;
  /**
   * How many separate plays one turn may be built from, and how many
   * candidates each step branches on. A person may lay as many as they can
   * find; this is how many the bot will look for. Depth 1 is a single word
   * and whatever it crosses.
   */
  chain: { depth: number; breadth: number };
}

export const LEVELS: Record<Difficulty, Level> = {
  // Everything the search can do. BLOCK_DEFAULTS, so the simulator's
  // unconfigured `rank` still measures the hardest bot anybody can be dealt.
  hard: {
    vocabulary: "full",
    squares: { ...BLOCK_DEFAULTS },
    chain: { depth: 4, breadth: 4 },
  },
  // Looks for squares, but only the handful nearest done.
  medium: {
    vocabulary: "common",
    squares: { maxK: 3, maxBlocks: 8 },
    chain: { depth: 3, breadth: 4 },
  },
  easy: {
    vocabulary: "common",
    squares: { maxK: 3, maxBlocks: 0 },
    chain: { depth: 2, breadth: 4 },
  },
};
