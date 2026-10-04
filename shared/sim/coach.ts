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
import { moveKey, type Hand, type Move, type ValueFn } from "./components.js";
import type { BagLeft } from "./judgement.js";
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

export const MAX_HINTS = 4;
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
 * player's own call. The price of spending a blank still applies, and is the
 * hint's own: see BLANK_PRICE.
 */
const SEARCH = {
  chain: LEVELS.hard.chain,
  squares: { ...LEVELS.hard.squares, nodeLimit: 2_000 },
  exposure: false as const,
};

/** One blank in the general search, and no square search: SEARCH has those. */
const ONE_BLANK = {
  chain: LEVELS.hard.chain,
  squares: { maxBlocks: 0 },
  exposure: false as const,
  blanksEverywhere: true,
};

/**
 * What a hint charges for each blank a play spends, with the bag as dealt.
 * It falls in a straight line to nothing as the bag empties (`blankPrice` in
 * judgement.ts), so early on a play has to beat the best blank-free one by
 * this much a blank to rank above it, and once there is nothing left to draw
 * a blank costs nothing at all. A first guess, not a measurement.
 */
export const BLANK_PRICE = 20;

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

/**
 * The hints worth showing, out of every ranked move, in rank order.
 *
 * The ranking already charges for each blank spent (BLANK_PRICE), so it
 * decides almost everything. Two things it cannot: the best play spending no
 * blanks is always on the list, however far down it ranks, so there is
 * always a way to keep them; and one idea is listed once. Two moves are the
 * same idea when `ideaOf` says so -- the same main word, in the coach -- and
 * the better-ranked one stands for both.
 */
export function choose<T extends { placements: readonly Placement[] }>(
  ranked: readonly T[],
  ideaOf: (move: T) => string,
  max: number = MAX_HINTS,
): T[] {
  const picked = new Set<T>();
  const plain = ranked.find((move) => move.placements.every((p) => !p.isBlank));
  if (plain !== undefined) picked.add(plain);
  const seen = new Set<string>();
  if (plain !== undefined) seen.add(ideaOf(plain));

  for (const move of ranked) {
    if (picked.size >= max) break;
    if (picked.has(move)) continue;
    const idea = ideaOf(move);
    if (seen.has(idea)) continue;
    seen.add(idea);
    picked.add(move);
  }
  return ranked.filter((move) => picked.has(move));
}

/** A play's main word: its longest, the first of them on a tie. */
function mainWord(move: HintMove): string {
  return move.words.reduce((best, w) => (w.word.length > best.length ? w.word : best), "");
}

export function coach(
  board: Board,
  hand: Hand,
  full: Lexicon,
  common: Lexicon,
  shape: BoardShape,
  size: number,
  bag: BagLeft,
): Coaching {
  const scoreOf: ValueFn = (after, placements, before) =>
    scoreTurn(after, placements, { before, bonusSquares: shape.bonusSquares }).total;
  const blanks = { reserve: BLANK_PRICE, bag };
  const ranked = rank(board, hand, full.dictionary, full.words, shape, size, scoreOf,
    { ...SEARCH, blanks });
  if (hand.blanks > 0) {
    // The search above spends blanks only on squares. A second pass lets one
    // blank stand in for a letter in an ordinary word -- NUT with no T in the
    // rack. One, not all of them: measured mid-game, one costs 2-3 seconds and
    // three cost up to fifteen. Its moves already priced, so they merge by value.
    const known = new Set(ranked.map((m) => moveKey(m.placements)));
    const oneBlank = rank(board, { letters: hand.letters, blanks: 1 }, full.dictionary,
      full.words, shape, size, scoreOf, { ...ONE_BLANK, blanks });
    for (const move of oneBlank) {
      if (known.has(moveKey(move.placements))) continue;
      ranked.push(move);
    }
    ranked.sort((a, b) => b.value - a.value);
  }
  // Explained only as far as choosing needs, not every move ranked.
  const explained = new Map<Move, HintMove>();
  const explainOnce = (m: Move) => {
    let hint = explained.get(m);
    if (hint === undefined) {
      hint = explain(board, m.placements, common, shape, size);
      explained.set(m, hint);
    }
    return hint;
  };
  return {
    moves: choose(ranked, (m) => mainWord(explainOnce(m))).map(explainOnce),
    rackWords: rackWordsOf(hand.letters, common),
  };
}
