import type { Board } from "../engine/board.js";
import type { Dictionary } from "../engine/legality.js";
import { applyPlacements } from "../engine/legality.js";
import { scoreTurn } from "../engine/score.js";
import type { BoardShape } from "../boards.js";
import type { WordIndex } from "./words.js";
import { chain } from "./chain.js";
import { components, type Hand, type Move, type ValueFn } from "./components.js";

export { indexWords, type LengthIndex, type WordIndex } from "./words.js";
export {
  anchors,
  components,
  moveKey,
  type Hand,
  type Move,
  type ValueFn,
} from "./components.js";

/**
 * A player that takes the best turn it can see.
 *
 * Not a strong player — it never sets up a square for next turn, and it spends
 * blanks the moment they pay — but a consistent one, which is what a balance
 * measurement needs. Two identical bots playing thousands of games say more
 * about the rules than about either of them.
 */

export interface MoveOptions {
  /** Scores a legal turn. Lets a variant reward letters differently. */
  value?: ValueFn;
  /** Longest word to consider. Longer words cost time and are rarely played. */
  maxLength?: number;
  /**
   * Look at what a move leaves behind before taking it.
   *
   * A greedy player takes the most points on offer and hands the board over
   * however open it leaves things — which is exactly the question "is going
   * first a disadvantage" turns on, since every tile placed is material for
   * whoever moves next. With this set, each candidate is worth what it scores
   * less what the best reply to it would score.
   *
   * The reply is measured against a stand-in rack rather than the opponent's
   * real one: the bot should not see their letters, and what is being
   * measured is how exposed the board is left, not what one hand can do to
   * it.
   */
  lookahead?: {
    /** The stand-in rack a reply is imagined from. */
    rack: readonly string[];
    /** How much of the reply's score to hold against a move. */
    weight: number;
    /** How many candidates to look this closely at. Each costs a search. */
    breadth?: number;
  };
  /**
   * How many plays may make up one turn, and how many candidates each step
   * considers. Depth 1 is the single-span search this started as.
   */
  chain?: { depth: number; breadth: number };
}

export type Difficulty = "easy" | "medium" | "hard";

/**
 * How much of what is on offer a player is willing to give up.
 *
 * Banding by score rather than by rank position, because rank is a weak
 * proxy: in a list of four hundred moves the first and the fortieth may both
 * score 21, and a rank band would call them far apart. A fraction of the best
 * available means what it sounds like — a hard player leaves about a seventh
 * of the points on the table, an easy one over half.
 */
const BANDS: Record<Difficulty, [number, number]> = {
  hard: [0.85, 1.0],
  medium: [0.55, 0.85],
  easy: [0.3, 0.55],
};

/**
 * How sharply a player prefers the top of its band.
 *
 * The band decides how good a move the bot is willing to play; this decides
 * how it picks among the moves it has settled for. One value for every
 * difficulty — the band already carries the difference.
 */
const TAU = 2.5;

/**
 * Choose among ranked moves, best first, by difficulty.
 *
 * `rng` returns a float in [0, 1). Exported for its own tests: the shape of
 * this distribution is the whole of how hard the game feels.
 */
export function chooseRanked(
  moves: readonly Move[],
  difficulty: Difficulty,
  rng: () => number,
): Move | null {
  if (moves.length === 0) return null;

  const [lo, hi] = BANDS[difficulty];
  const best = moves[0].value;
  let band: readonly Move[];

  if (best <= 0) {
    /*
     * Every move is a bad one. Fractions of a non-positive best invert the
     * ordering -- half of -10 is -5, which is better, not worse -- so the
     * band is read as positions down the list instead.
     */
    const from = Math.floor((1 - hi) * moves.length);
    const to = Math.max(from + 1, Math.ceil((1 - lo) * moves.length));
    band = moves.slice(from, to);
  } else {
    band = moves.filter((m) => m.value >= lo * best && m.value <= hi * best);

    /*
     * Nothing in the band: too few moves, or all of them bunched above it.
     * Widen upward to the weakest move that still clears the floor -- the
     * closest thing to what was asked for. Never downward, and never no move
     * at all: a bot with something legal to play has to play it.
     */
    if (band.length === 0) {
      const above = moves.filter((m) => m.value >= lo * best);
      band = above.length > 0 ? [above[above.length - 1]] : [moves[0]];
    }
  }

  const weights = band.map((_, i) => Math.exp(-i / TAU));
  const total = weights.reduce((sum, w) => sum + w, 0);

  let roll = rng() * total;
  for (const [i, weight] of weights.entries()) {
    roll -= weight;
    if (roll < 0) return band[i];
  }
  return band[band.length - 1];
}

export function bestMove(
  board: Board,
  hand: Hand,
  dictionary: Dictionary,
  words: WordIndex,
  shape: BoardShape,
  size: number,
  options: MoveOptions = {},
): Move | null {
  const scoreOf: ValueFn =
    options.value ?? ((after, p, before) => scoreTurn(after, p, { before }).total);

  // Two passes: tiles first, blanks only if the rack alone cannot play. That
  // is both how a decent player treats a blank and what keeps this quick —
  // with blanks in hand every word is a candidate for every square.
  const withTiles = search(
    board,
    { ...hand, blanks: 0 },
    dictionary,
    words,
    shape,
    size,
    scoreOf,
    options,
  );
  if (withTiles !== null || hand.blanks === 0) return withTiles;
  return search(board, hand, dictionary, words, shape, size, scoreOf, options);
}

function search(
  board: Board,
  hand: Hand,
  dictionary: Dictionary,
  words: WordIndex,
  shape: BoardShape,
  size: number,
  scoreOf: ValueFn,
  options: MoveOptions,
): Move | null {
  return rank(board, hand, dictionary, words, shape, size, scoreOf, options)[0] ?? null;
}

/**
 * Every legal move, best first.
 *
 * The search already had to find and score them all to pick one; handing the
 * list back is what lets a player choose by difficulty rather than always
 * taking the top.
 */
export function rank(
  board: Board,
  hand: Hand,
  dictionary: Dictionary,
  words: WordIndex,
  shape: BoardShape,
  size: number,
  scoreOf: ValueFn,
  options: MoveOptions,
): Move[] {
  // Chaining at depth 1 already returns exactly the single-span moves, so the
  // branch is only there to skip the wrapper's bookkeeping.
  const chaining = options.chain ?? { depth: 2, breadth: 6 };
  const found = chaining.depth <= 1
    ? components(board, hand, dictionary, words, shape, size, scoreOf,
        { maxLength: options.maxLength, before: board })
    : chain(board, hand, dictionary, words, shape, size, scoreOf,
        { ...chaining, maxLength: options.maxLength });

  const ahead = options.lookahead;
  if (ahead === undefined || found.length === 0) return found;

  /*
   * Only the strongest few are looked at this closely: each costs a whole
   * search of its own, and a move outside the top handful is not going to win
   * once a penalty is subtracted from it.
   */
  const looked = found.slice(0, ahead.breadth ?? 6).map((move) => {
    const after = applyPlacements(board, move.placements);
    const reply = search(
      after,
      { letters: ahead.rack, blanks: 0 },
      dictionary,
      words,
      shape,
      size,
      scoreOf,
      { maxLength: options.maxLength },
    );

    return { ...move, value: move.value - ahead.weight * (reply?.score ?? 0) };
  });

  // Re-ranked by what each move nets, with the rest of the list behind them.
  looked.sort((a, b) => b.value - a.value);
  return [...looked, ...found.slice(ahead.breadth ?? 6)];
}
