/**
 * A player that takes the best turn it can see, less what that turn gives away.
 *
 * Not a strong player — it never sets up a square for next turn, and it reads
 * only one move deep — but a consistent one, which is what a balance
 * measurement needs. Two identical bots playing thousands of games say more
 * about the rules than about either of them.
 *
 * What it does read is what a turn leaves behind (`exposure`) and what a blank
 * is worth keeping (`blankPrice`), both in judgement.ts. Neither touches
 * `score`: a move's points are its points, and every penalty lands on `value`,
 * which is all the ranking and the difficulty bands ever look at.
 */

import type { Board } from "../engine/board.js";
import type { Dictionary } from "../engine/legality.js";
import { scoreTurn } from "../engine/score.js";
import type { BoardShape } from "../boards.js";
import type { WordIndex } from "./words.js";
import { blankMoves, blockMoves, type BlockOptions } from "./blocks.js";
import { chain } from "./chain.js";
import { components, moveKey, type Hand, type Move, type ValueFn } from "./components.js";
import { blankPrice, exposure, type ExposureWeights } from "./judgement.js";

export { indexWords, type LengthIndex, type WordIndex } from "./words.js";
export {
  anchors,
  components,
  moveKey,
  type Hand,
  type Move,
  type ValueFn,
} from "./components.js";

export interface MoveOptions {
  /** Scores a legal turn. Lets a variant reward letters differently. */
  value?: ValueFn;
  /** Longest word to consider. Longer words cost time and are rarely played. */
  maxLength?: number;
  /**
   * How many plays may make up one turn, and how many candidates each step
   * considers. Depth 1 is the single-span search this started as.
   */
  chain?: { depth: number; breadth: number };
  /**
   * How far to go looking for k x k blocks to finish, and how long the solver
   * may spend on one.
   *
   * Every field optional, and forwarded whole to `blockMoves`: a caller under
   * a time limit needs to be able to tighten `nodeLimit` or `reletter` alone
   * without restating the defaults it is happy with. See blocks.ts, which owns
   * every default here, `reletter` -- how many standing tiles one turn may
   * write over -- included.
   */
  squares?: BlockOptions;
  /**
   * How heavily to weigh what a move leaves behind. `false` is the greedy
   * player: most points now, whatever it opens up.
   *
   * On by default, and cheap enough to be: this is counted off the grid
   * rather than bought with a search per candidate. See `exposure` in
   * judgement.ts.
   */
  exposure?: Partial<ExposureWeights> | false;
  /** What a blank must beat to be worth spending. `false` never spends one. */
  blanks?: { reserve: number } | false;
  /** Let the general search spend blanks too. Slow; for measurement. */
  blanksEverywhere?: boolean;
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
 * Choose among ranked moves by difficulty.
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

  /*
   * Ordered here rather than taken on trust from the caller.
   *
   * Both branches below read the list as best-first: one takes the head as
   * the best on offer and bands as a fraction of it, the other reads the band
   * off positions down the list. Hand either an unsorted list and the band is
   * computed from the wrong number -- for `hard`, whose ceiling is the best
   * itself, the genuinely strongest move is then filtered out of its own
   * band. This is exported, so that is a caller's honest mistake rather than
   * an impossible one, and sorting an already-sorted list costs nothing next
   * to the search that produced it.
   */
  const ordered = [...moves].sort((a, b) => b.value - a.value);

  const [lo, hi] = BANDS[difficulty];
  const best = ordered[0].value;
  let band: readonly Move[];

  if (best <= 0) {
    /*
     * Every move is a bad one. Fractions of a non-positive best invert the
     * ordering -- half of -10 is -5, which is better, not worse -- so the
     * band is read as positions down the list instead.
     */
    const from = Math.floor((1 - hi) * ordered.length);
    const to = Math.max(from + 1, Math.ceil((1 - lo) * ordered.length));
    band = ordered.slice(from, to);
  } else {
    band = ordered.filter((m) => m.value >= lo * best && m.value <= hi * best);

    /*
     * Nothing in the band: too few moves, or all of them bunched above it.
     * Widen upward to the weakest move that still clears the floor -- the
     * closest thing to what was asked for. Never downward, and never no move
     * at all: a bot with something legal to play has to play it.
     */
    if (band.length === 0) {
      const above = ordered.filter((m) => m.value >= lo * best);
      band = above.length > 0 ? [above[above.length - 1]] : [ordered[0]];
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
  /*
   * One search. There used to be two — tiles first, blanks only if the rack
   * alone could not play at all — which is not restraint but paralysis: a
   * blank that closes a 3x3 is worth nine points and was never once spent on
   * one. `blankPrice` says the same thing properly, so the ranking decides.
   */
  const scoreOf: ValueFn =
    options.value ?? ((after, p, before) => scoreTurn(after, p, { before }).total);

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
  const everywhere = options.blanksEverywhere === true && options.blanks !== false;
  const found = chaining.depth <= 1
    ? components(board, hand, dictionary, words, shape, size, scoreOf,
        { maxLength: options.maxLength, before: board, blanks: everywhere })
    : chain(board, hand, dictionary, words, shape, size, scoreOf,
        { ...chaining, maxLength: options.maxLength, blanks: everywhere });

  /*
   * The squares neither of the above can reach.
   *
   * Not every word square is out of their reach -- most are not. A block whose
   * remaining gaps lie in one line is an ordinary span, and a block whose gaps
   * can be filled a legal play at a time is what chaining is for; between them
   * they take almost all of the squares that come up. What is left is the
   * block whose gaps are non-collinear *and* individually illegal -- the four
   * corners of a 3x3, where one corner alone spells a two-letter fragment that
   * is not a word. No search built out of legal plays can lay the first tile
   * of one, because there is no legal first tile.
   *
   * Those are rare, and measured, this pass earns little (see the note in
   * blocks.ts). It is kept because it is about 1% of the search's time and it
   * is the only thing that can reach them at all.
   */
  const blocks = blockMoves(board, hand, dictionary, words, shape, size, scoreOf,
    options.squares ?? {});

  /*
   * The one place a blank is offered on its own.
   *
   * The general search does not spend blanks, because with one in hand every
   * word of a length is a candidate for every span of it. This asks a much
   * smaller question -- twenty-six letters against the handful of squares that
   * are the last gap in a block -- and leaves the price to say whether any of
   * them is worth it.
   */
  const blanks = options.blanks === false
    ? []
    : blankMoves(board, hand, dictionary, shape, size, scoreOf, options.squares ?? {});

  // The stages reach some of the same turns; the key settles it.
  const merged = [...found];
  const known = new Set(found.map((m) => moveKey(m.placements)));
  for (const move of [...blocks, ...blanks]) {
    const key = moveKey(move.placements);
    if (known.has(key)) continue;
    known.add(key);
    merged.push(move);
  }

  /*
   * What a move scores is not what it is worth: the points stand, and the
   * opinion of them is all the ranking reads.
   *
   * `blanks: false` is a refusal rather than a price, so it cannot be written
   * as an infinite one -- an infinity times a move that spends no blank is
   * NaN, and NaN sorts nowhere. The moves are marked and dropped instead.
   */
  const reserve = options.blanks === false ? undefined : options.blanks?.reserve;
  for (const move of merged) {
    const usesBlank = move.placements.some((p) => p.isBlank);
    if (options.blanks === false && usesBlank) {
      move.value = Number.NEGATIVE_INFINITY;
      continue;
    }

    const penalty =
      (options.exposure === false
        ? 0
        : exposure(board, move.placements, shape, size, options.exposure ?? {})) +
      (usesBlank ? blankPrice(board, move.placements, reserve) : 0);
    move.value = move.score - penalty;
  }

  const playable = options.blanks === false
    ? merged.filter((m) => m.value !== Number.NEGATIVE_INFINITY)
    : merged;
  playable.sort((a, b) => b.value - a.value);

  return playable;
}
