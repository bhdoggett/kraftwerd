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
 * 6: the word list, which is part of the rules and had not been treated as
 *    it. Which words play decides what a rack is worth and what a board can
 *    become, so a score set against a different dictionary is not competing
 *    with these -- as surely as one set from a different bag. Two changes
 *    had already gone by unstamped: SCOWL's 76,911 words to ENABLE +
 *    12dicts' 172,788, and then 175,800 when a line-ending bug stopped
 *    dropping the second source. This version is that list.
 * 7: double-word squares (design.md §2, §4) — twelve of them, on the four
 *    corner diagonals, each paying once to whoever first covers it. A word
 *    crossing two of them in one play quadruples, so the ceiling on a turn
 *    moves as well as the average: a score set on a board without them is
 *    not competing with these.
 * 8: squares, long words and the rack bonus retuned together (design.md §4)
 *    — a 2x2 no longer pays anything, at any size it's nested inside; a
 *    k x k square of k >= 3 pays `SQUARE_BONUS_STEP * k` rather than k^2, so
 *    3x3 is 33 and 4x4 is 44 instead of 9 and 16; any word of
 *    `LONG_WORD_MIN` letters or more pays a flat `LONG_WORD_BONUS` on top,
 *    whether or not it used the whole rack; and `RACK_CLEAR_BONUS` drops
 *    from 15 to 5, so the tempo of clearing your rack every turn no longer
 *    outweighs holding tiles back for a square or a long word. A score set
 *    under any of the old numbers is not competing with these.
 */
export const RULES_VERSION = 8;

/**
 * How many words the shipped dictionary holds.
 *
 * Written down so a rebuild cannot change the language quietly:
 * shared/dictionary-version.test.ts holds shared/data/words.json to this
 * number and goes red the moment the list moves. Update it and RULES_VERSION
 * together -- that red is the reminder the word list is part of the rules.
 */
export const DICTIONARY_WORDS = 175800;

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
 * The smallest square that pays a bonus at all (design.md §4.2).
 *
 * A 2x2 used to be worth k^2 = 4, and it was too easy to be worth chasing:
 * completing one asked almost nothing of a placement, so it paid out on
 * turns that were not really about the square at all. Raising the floor to
 * 3 does not shrink the bonus, it removes the bottom rung entirely -- a 2x2
 * inside a bigger completed block no longer contributes to its total either,
 * the same as a bare one pays nothing on its own.
 */
export const MIN_SQUARE_SIZE = 3;

/**
 * What a side of `k` pays for finishing a k x k block, for k >= MIN_SQUARE_SIZE
 * (design.md §4.2). A k x k square is worth `SQUARE_BONUS_STEP * k`.
 *
 * Was k^2 -- 9 for a 3x3, 16 for a 4x4 -- until the 2x2 floor moved to 3: a
 * 3x3 used to lean on four nested 2x2 bonuses (16 more) it can no longer
 * collect, so its own number had to stand on its own rather than just being
 * restored to where it used to net out. 11 was picked because it lands on
 * two clean, rememberable numbers where the game is actually played: 33 for
 * a 3x3, 44 for a 4x4 -- and the same rule then carries on unremarkably for
 * anything bigger, rather than needing a new special case at every size.
 */
export const SQUARE_BONUS_STEP = 11;

/**
 * Shortest word that earns the flat length bonus below (design.md §4.1).
 *
 * Chosen to fill the gap the 2x2 floor moving to 3 left behind: a bare
 * 5-letter word previously scored 5 points and nothing else, the same flat
 * 1 point a tile as any other word, with no achievable bonus between that
 * and a hard-to-reach 3x3. Five is a genuine step up from the four-and
 * -under words most turns are made of, without being as rare as a square.
 */
export const LONG_WORD_MIN = 5;

/**
 * Flat bonus for a word of `LONG_WORD_MIN` letters or more (design.md §4.1),
 * on top of its own word points -- the way `stackBonus` flatly rewards
 * landing on a stack, without reshaping the per-letter formula everything
 * else is built on. Applies once per qualifying word a turn forms, and is
 * never doubled by a bonus square: it rewards the word being long, not the
 * square it happens to cross.
 *
 * Set so a bare 5-letter word (5 word points) lands at 10, exactly the
 * 2.0-a-tile rate a bare 2x2 used to pay -- taking over that tier honestly
 * rather than by coincidence, now that a 2x2 pays nothing at all.
 */
export const LONG_WORD_BONUS = 5;

/**
 * Bonus for playing every letter in your rack in a single turn (design.md
 * §4.7). Word points alone are flat, 1 per letter, so a lone long word pays
 * far less per tile than a compact square does. This adds a flat reward for
 * the big, single-turn play, the way `stackBonus` flatly rewards landing on
 * a stack, without reshaping the per-letter formula everything else is
 * built on.
 *
 * Deliberately a tempo nudge rather than a second jackpot. At 15 this was
 * worth more, repeated every turn a rack happened to empty, than the rarer
 * squares and long words were meant to be the real ceiling -- which is
 * exactly backwards from what should be worth chasing, and left holding
 * tiles back for something bigger a losing move against just dumping the
 * rack every turn. At 5, a full rack played as one plain 7-letter word
 * scores 7 + 5 (LONG_WORD_BONUS, since 7 >= LONG_WORD_MIN) + 5 = 17: still
 * worth doing, never worth doing *instead of* building something bigger.
 */
export const RACK_CLEAR_BONUS = 5;

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
