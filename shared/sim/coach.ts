/**
 * Hints for a person: the bot's search, pointed at their own rack, and the
 * reasons each move scores.
 *
 * The hard bot's search (shared/sim/levels.ts), so a hint shows what is
 * really on offer -- including the squares that need a word nobody knows,
 * flagged as rare rather than left out. Ranked by value, not by points, so a
 * move that hands the bot a square is pushed down the list the way the bot
 * would push it down its own.
 */
import type { BoardShape } from "../boards.js";
import type { Board } from "../engine/board.js";
import { applyPlacements } from "../engine/legality.js";
import { nearSquares } from "../engine/nearSquares.js";
import { scoreTurn, type Placement } from "../engine/score.js";
import { rank } from "./bot.js";
import type { Hand, ValueFn } from "./components.js";
import { LEVELS, type Lexicon } from "./levels.js";
import { rackWords } from "./words.js";

export interface HintWord {
  word: string;
  points: number;
  /** Not in the common list: a real word, but not one most people know. */
  rare: boolean;
  /** The multiplier squares this word crossed, multiplied together. */
  multiplier?: number;
  /** Earned the long-word bonus. */
  long?: boolean;
}

export interface HintMove {
  placements: Placement[];
  total: number;
  words: HintWord[];
  /** 3x3s this move completes. */
  squares: number;
  /** 3x3s this move leaves one tile short, for whoever plays next. */
  leavesOpen: number;
}

export interface Coaching {
  moves: HintMove[];
  /** Common words the rack's own letters spell, ignoring the board. */
  rackWords: string[];
}

/** What the coach action answers with: coaching for one turn of one game. */
export interface HintResult extends Coaching {
  turnNumber: number;
}

export const MAX_HINTS = 3;
export const MAX_RACK_WORDS = 20;

/**
 * The hard bot's search, with the square solver's node budget capped: a hint
 * is a person waiting on a button, and with three blanks in hand the uncapped
 * solver measured up to six seconds.
 *
 * Without the bot's defence. A bot marks a move down for what it leaves open
 * to the next player (`exposure` in judgement.ts), and so a hint on an empty
 * board offered a tight 2x2 for 12 over a long word across the centre for 17.
 * A hint answers "what scores most", and how much to give away is the
 * player's own call. The price of spending a blank still applies.
 */
const SEARCH = {
  chain: LEVELS.hard.chain,
  squares: { ...LEVELS.hard.squares, nodeLimit: 2_000 },
  exposure: false as const,
};

export function explain(
  before: Board,
  placements: readonly Placement[],
  common: Lexicon,
  shape: BoardShape,
  size: number,
): HintMove {
  const after = applyPlacements(before, placements);
  const score = scoreTurn(after, placements, { before, bonusSquares: shape.bonusSquares });
  return {
    placements: placements.map(({ x, y, letter, isBlank }) => ({ x, y, letter, isBlank })),
    total: score.total,
    words: score.words.map((w) => ({
      word: w.word,
      points: w.points,
      rare: !common.dictionary.has(w.word),
      ...(w.bonus !== undefined ? { multiplier: w.bonus } : {}),
      ...(w.long === true ? { long: true } : {}),
    })),
    squares: score.squares.length,
    leavesOpen: nearSquares(before, placements, shape, size).length,
  };
}

export function rackWordsOf(letters: readonly string[], common: Lexicon): string[] {
  const found = new Set<string>();
  for (let length = Math.min(letters.length, 7); length >= 3; length--) {
    const index = common.words.byLength.get(length);
    if (index === undefined) continue;
    for (const i of rackWords(index, letters, length)) found.add(index.words[i]);
  }
  return [...found]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, MAX_RACK_WORDS);
}

export function coach(
  board: Board,
  hand: Hand,
  full: Lexicon,
  common: Lexicon,
  shape: BoardShape,
  size: number,
): Coaching {
  const scoreOf: ValueFn = (after, placements, before) =>
    scoreTurn(after, placements, { before, bonusSquares: shape.bonusSquares }).total;
  const ranked = rank(board, hand, full.dictionary, full.words, shape, size, scoreOf, SEARCH);
  return {
    moves: ranked.slice(0, MAX_HINTS).map((m) => explain(board, m.placements, common, shape, size)),
    rackWords: rackWordsOf(hand.letters, common),
  };
}
