import weights from "./data/letter-weights.json" with { type: "json" };
import type { RackConfig } from "./engine/rack.js";

/**
 * Every tunable in one place, as data. These numbers are balance knobs and are
 * expected to change from real games; nothing in the engine reads them
 * directly.
 */

export const RACK: RackConfig = {
  /**
   * Letters held at the start of a turn, refilled after every play. Blanks
   * are not among them: those are a whole-game allowance, held separately.
   *
   * Seven, which is the size most of these games settle on: enough to hold a
   * word and a spare, few enough that a bad draw still hurts.
   */
  size: 7,
  // Real English letter frequency, out of a 50-letter pool, nudged toward
  // letters that are good at turning one word into another by swapping a
  // single tile -- see design.md §5.1. Hand-written in
  // shared/data/letter-weights.json, not generated, so it survives a
  // dictionary rebuild untouched.
  weights,
  vowels: "AEIOU",
  /**
   * Held over from the endless draw, which could keep rolling until a rack met
   * them. A bag cannot: it gives what it has, so these no longer bind. The
   * vowel share is set in the bag itself instead — twenty-seven of
   * seventy-one, which for a rack of seven leaves about one hand in five
   * short of vowels.
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
 * Which rules a game was played under.
 *
 * Bump this whenever a change makes scores incomparable with older ones — the
 * bag, the rack, what a square pays. A record is the thing people get attached
 * to, and a best score set with eight tiles from a fifty-tile bag is not
 * competing with anything set since.
 *
 * Stamped on a game when it is created, so a game finishes under the rules it
 * began with. Records count only games at the current version, which means a
 * rules change costs nobody their game history: the games stay, replayable and
 * intact, and stop counting toward a score they never competed for.
 *
 * 1: fifty tiles, a rack of eight.
 * 2: seventy-one tiles, a rack of seven. Version 1 was live and played on
 *    under the old bag, so those scores are not competing with these.
 * 4: added RACK_CLEAR_BONUS (design.md §4.7) — playing every letter in your
 *    rack in one turn now pays extra, so scores under 3 do not compete with
 *    these.
 * 5: ninety-nine tiles (design.md §5.1), up from seventy-one, favouring
 *    letters that are good at turning one word on the board into another.
 *    A bigger bag deals a longer game, and the mix is not a rescale of the
 *    old one, so scores under 4 do not compete with these.
 */
export const RULES_VERSION = 5;

/**
 * How long an invite link works for. Long enough to sit in a message over a
 * weekend, short enough that a link forwarded on, or found in an old thread,
 * stops working on its own.
 */
export const FRIEND_LINK_DAYS = 7;

/**
 * A square may hold at most this many tiles over its lifetime, the original
 * included -- so at most STACK_CAP - 1 tiles may ever land on top of one.
 * Without a limit a single square could be fought over forever; two lets it
 * change hands once and then settles.
 *
 * The bonus for landing on an already-occupied square equals how deep the
 * stack now runs -- 2 for the tile stacked on top, which is also the cap --
 * so it scales with STACK_CAP by construction: change the cap and the top
 * bonus follows it. See scoreTurn in shared/engine/score.ts.
 */
export const STACK_CAP = 2;

/**
 * Bonus for playing every letter in your rack in a single turn (design.md
 * §4.7). Word points alone are flat, 1 per letter, so a lone long word pays
 * far less per tile than a compact square does — a 7-letter word nets 1.0
 * point a tile against a 3x3's 3.8. This adds a flat reward for the big,
 * single-turn play, the way `stackBonus` flatly rewards landing on a stack,
 * without reshaping the per-letter formula everything else is built on.
 *
 * Set so a full rack played as one plain 7-letter word (7 word points, no
 * squares) lands between a 2x2's rate and a 3x3's: 7 + 15 = 22, 3.1 a tile.
 * A word that also crosses existing tiles or completes a square pays more
 * on top, same as any other turn.
 */
export const RACK_CLEAR_BONUS = 15;

/**
 * How well a computer player plays.
 *
 * It sees every legal move at every level; the difficulty is how much of what
 * it sees it is willing to give up. Each level is a band of the best value on
 * offer — `hard` plays between 66% and 100% of it, `medium` between 33% and
 * 66%, `easy` between 5% and 33% — and inside its band every level leans on
 * the top of it equally hard. So a level is a standard of play rather than a
 * degree of carelessness, which is what makes it legible from a game: an
 * opponent that always finds the best word is not one anybody enjoys losing
 * to, and one that plays a fixed fraction of it loses in a way that reads as
 * a level rather than as luck.
 *
 * The bands themselves are in shared/sim/bot.ts, which is where to tune them.
 */
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

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
  /**
   * Three, one for each colour on the board -- see `--seat-0..2` in
   * `src/index.css`. A colour is always one of those three regardless of how
   * many people are actually at the table (§ below), so the seat count and
   * the colour count are the same number by construction, not by accident.
   */
  maxPlayers: 3,
} as const;
