import { STACK_CAP } from "../config.js";
import { cellKey, type Board } from "../engine/board.js";
import type { Dictionary } from "../engine/legality.js";
import { applyPlacements, validateTurn } from "../engine/legality.js";
import type { Placement } from "../engine/score.js";
import { scoreTurn } from "../engine/score.js";
import type { BoardShape } from "../boards.js";

/**
 * A player that takes the best turn it can see.
 *
 * Not a strong player — it never sets up a square for next turn, and it spends
 * blanks the moment they pay — but a consistent one, which is what a balance
 * measurement needs. Two identical bots playing thousands of games say more
 * about the rules than about either of them.
 */

export interface Move {
  placements: Placement[];
  score: number;
}

/**
 * Words the bot may consider, indexed for fast span matching.
 *
 * Scanning every word against every span was the first version and it was far
 * too slow to run thousands of games. For a span with letters already in it,
 * the posting lists answer "which words have T here and A there" directly, and
 * the letter masks throw out anything the rack cannot spell before the
 * expensive checks run.
 */
export interface LengthIndex {
  words: string[];
  /** Bit per distinct letter, for a subset test against the rack. */
  masks: Uint32Array;
  /** "position:letter" to the words that have it. */
  posting: Map<string, number[]>;
  /** Sorted letters to the words that spell them. */
  anagrams: Map<string, number[]>;
}

export interface WordIndex {
  byLength: Map<number, LengthIndex>;
  has: (word: string) => boolean;
}

const bit = (letter: string) => 1 << (letter.charCodeAt(0) - 65);

function maskOf(word: string): number {
  let mask = 0;
  for (const letter of word) mask |= bit(letter);
  return mask;
}

export function indexWords(words: Iterable<string>, maxLength: number): WordIndex {
  const byLength = new Map<number, LengthIndex>();
  const all = new Set<string>();

  for (const raw of words) {
    const word = raw.toUpperCase();
    all.add(word);
    if (word.length < 2 || word.length > maxLength) continue;

    let index = byLength.get(word.length);
    if (index === undefined) {
      index = { words: [], masks: new Uint32Array(0), posting: new Map(), anagrams: new Map() };
      byLength.set(word.length, index);
    }
    const at = index.words.length;
    index.words.push(word);

    const sorted = [...word].sort().join("");
    const same = index.anagrams.get(sorted);
    if (same === undefined) index.anagrams.set(sorted, [at]);
    else same.push(at);
    for (let i = 0; i < word.length; i++) {
      const key = `${i}:${word[i]}`;
      const list = index.posting.get(key);
      if (list === undefined) index.posting.set(key, [at]);
      else list.push(at);
    }
  }

  for (const index of byLength.values()) {
    index.masks = Uint32Array.from(index.words, maskOf);
  }

  return { byLength, has: (word) => all.has(word) };
}

/**
 * Words of length `length` that the rack can spell outright.
 *
 * A span with nothing in it used to be matched by scanning every word of that
 * length, for every such span — which is where the time went. There are at
 * most 35 ways to choose 5 letters from a rack of 7, so asking the other way
 * round is thousands of times cheaper.
 */
function rackWords(index: LengthIndex, letters: readonly string[], length: number): number[] {
  if (letters.length < length) return [];

  const found: number[] = [];
  const chosen: string[] = [];

  const walk = (from: number) => {
    if (chosen.length === length) {
      const hits = index.anagrams.get([...chosen].sort().join(""));
      if (hits !== undefined) found.push(...hits);
      return;
    }
    for (let i = from; i < letters.length; i++) {
      // Identical letters at the same depth give the same subset twice.
      if (i > from && letters[i] === letters[i - 1]) continue;
      chosen.push(letters[i]!);
      walk(i + 1);
      chosen.pop();
    }
  };

  walk(0);
  return found;
}

/** Word indices matching every fixed letter, smallest posting list first. */
/**
 * Words that match the letters already in the span, or match all but one.
 *
 * The odd one out is a square the play would cover. Dropping each fixed
 * position in turn is what turns "the board says A here" from a requirement
 * into a choice; `fit` then charges a tile for disagreeing, and the legality
 * check has the last word on whether covering it is allowed.
 */
function withOneCovered(
  index: LengthIndex,
  fixed: [number, string][],
  rackPool: readonly number[],
): number[] {
  const pool = new Set<number>(candidates(index, fixed) ?? []);

  for (let skip = 0; skip < fixed.length; skip++) {
    const rest = fixed.filter((_, i) => i !== skip);
    // Nothing left to match on: the rack decides, exactly as for a span with
    // no letters in it at all.
    // With nothing left to match on, the rack decides — exactly as for a span
    // with no letters in it at all, so the same list serves.
    const found = rest.length > 0 ? candidates(index, rest)! : rackPool;
    for (const i of found) pool.add(i);
  }

  return [...pool];
}

function candidates(index: LengthIndex, fixed: [number, string][]): number[] | null {
  if (fixed.length === 0) return null;

  const lists = fixed.map(([i, ch]) => index.posting.get(`${i}:${ch}`) ?? []);
  lists.sort((a, b) => a.length - b.length);

  let hits = lists[0]!;
  for (const list of lists.slice(1)) {
    const other = new Set(list);
    hits = hits.filter((i) => other.has(i));
    if (hits.length === 0) break;
  }
  return hits;
}

type Span = { x: number; y: number; dx: number; dy: number; length: number };

/** Every straight run of `length` cells that fits on the board. */
function* spans(size: number, length: number): Generator<Span> {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x + length <= size) yield { x, y, dx: 1, dy: 0, length };
      if (y + length <= size) yield { x, y, dx: 0, dy: 1, length };
    }
  }
}

interface Hand {
  letters: readonly string[];
  blanks: number;
}

/**
 * Whether `word` can be laid along `span`: the letters already there must
 * match, and the rest must come out of the hand. Returns what it would cost
 * in tiles, or null.
 */
function fit(
  board: Board,
  span: Span,
  word: string,
  hand: Hand,
): { placements: Placement[]; used: number } | null {
  const need = new Map<string, number>();
  const placements: Placement[] = [];
  let touched = false;

  for (let i = 0; i < span.length; i++) {
    const x = span.x + i * span.dx;
    const y = span.y + i * span.dy;
    const letter = word[i]!;
    const sitting = board.get(cellKey(x, y));

    if (sitting !== undefined) {
      // The letter already there serves, and costs nothing.
      if (sitting.letter === letter) {
        touched = true;
        continue;
      }

      /*
       * Otherwise the square can be played over, at the price of a tile.
       *
       * This used to give up instead, which meant the bot never once laid a
       * tile on another — so it never took a square from anyone, never earned
       * a stacking bonus, and never covered a letter to make a block
       * reachable. Everything measured about stacking was measuring a game
       * nobody was playing.
       */
      if ((sitting.stacked ?? 1) >= STACK_CAP) return null;
      touched = true;
    }

    need.set(letter, (need.get(letter) ?? 0) + 1);
    placements.push({ x, y, letter, isBlank: false });
  }

  if (placements.length === 0) return null;

  // Spend tiles first, then blanks for whatever the rack cannot cover.
  const held = new Map<string, number>();
  for (const l of hand.letters) held.set(l, (held.get(l) ?? 0) + 1);

  let blanksLeft = hand.blanks;
  const asBlank = new Map<string, number>();
  for (const [letter, count] of need) {
    const have = held.get(letter) ?? 0;
    const short = count - have;
    if (short > 0) {
      if (short > blanksLeft) return null;
      blanksLeft -= short;
      asBlank.set(letter, short);
    }
  }

  for (const placement of placements) {
    const short = asBlank.get(placement.letter) ?? 0;
    if (short > 0) {
      placement.isBlank = true;
      asBlank.set(placement.letter, short - 1);
    }
  }

  // An opening play covers the centre; everything else has to touch what is
  // already there. Cheap to check here, and it throws out most spans.
  if (board.size > 0 && !touched) {
    const near = placements.some(({ x, y }) =>
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => board.has(cellKey(x + dx!, y + dy!))),
    );
    if (!near) return null;
  }

  return { placements, used: placements.length };
}

export interface MoveOptions {
  /** Scores a legal turn. Lets a variant reward letters differently. */
  value?: (board: Board, placements: readonly Placement[]) => number;
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
}

export type Difficulty = "easy" | "medium" | "hard";

/**
 * How sharply a player prefers its best move.
 *
 * The bot sees every legal move and can rank them; playing the top one every
 * time makes an opponent nobody can beat and nobody enjoys. So the rank is a
 * weighting rather than a decision: weight falls away as exp(-rank / tau), and
 * tau is the difficulty. Small tau means the best move nearly always; large
 * tau spreads the choice down the list.
 *
 * Even hard is not perfect — it takes its best move about seven times in ten,
 * which is roughly what a strong player who is not concentrating does.
 */
const TAU: Record<Difficulty, number> = {
  easy: 8,
  medium: 2.5,
  hard: 0.8,
};

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

  const tau = TAU[difficulty];
  const weights = moves.map((_, i) => Math.exp(-i / tau));
  const total = weights.reduce((sum, w) => sum + w, 0);

  let roll = rng() * total;
  for (const [i, weight] of weights.entries()) {
    roll -= weight;
    if (roll < 0) return moves[i]!;
  }
  return moves[moves.length - 1]!;
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
  const value = options.value ?? ((b, p) => scoreTurn(b, p).total);

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
    value,
    options,
  );
  if (withTiles !== null || hand.blanks === 0) return withTiles;
  return search(board, hand, dictionary, words, shape, size, value, options);
}

function search(
  board: Board,
  hand: Hand,
  dictionary: Dictionary,
  words: WordIndex,
  shape: BoardShape,
  size: number,
  value: (board: Board, placements: readonly Placement[]) => number,
  options: MoveOptions,
): Move | null {
  return rank(board, hand, dictionary, words, shape, size, value, options)[0] ?? null;
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
  value: (board: Board, placements: readonly Placement[]) => number,
  options: MoveOptions,
): Move[] {
  const tiles = hand.letters.length + hand.blanks;
  const longest = Math.min(options.maxLength ?? 7, tiles + 4);
  const sortedRack = [...hand.letters].sort();
  const found: Move[] = [];

  // Squares worth building through: occupied, or touching something occupied.
  // On an empty board there is only one — the centre the opening must cover.
  const live = new Set<string>();
  if (board.size === 0) {
    live.add(cellKey(shape.centre.x, shape.centre.y));
  } else {
    for (const key of board.keys()) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      live.add(key);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size) live.add(cellKey(nx, ny));
      }
    }
  }

  const rackMask = hand.letters.reduce((mask, l) => mask | (1 << (l.charCodeAt(0) - 65)), 0);
  const anyLetter = hand.blanks > 0;

  for (let length = 2; length <= longest; length++) {
    const index = words.byLength.get(length);
    if (index === undefined) continue;

    /*
     * What the rack alone can spell at this length, worked out once.
     *
     * Every span with a single letter on it falls back to this list, and
     * enumerating it per span made the search cost far more than the covering
     * moves it found were worth.
     */
    const rackPool = anyLetter
      ? index.words.map((_, i) => i)
      : rackWords(index, sortedRack, length);

    for (const span of spans(size, length)) {
      // Read the span once: which squares are taken, and does it touch play.
      const fixed: [number, string][] = [];
      let touchesLive = false;
      let blockedSquare = false;
      let free = 0;
      /* Letters the span supplies itself, which the rack does not have to. */
      let spanMask = 0;

      for (let i = 0; i < length; i++) {
        const x = span.x + i * span.dx;
        const y = span.y + i * span.dy;
        const key = cellKey(x, y);
        if (shape.blocked.has(key)) {
          blockedSquare = true;
          break;
        }
        const sitting = board.get(key);
        if (sitting === undefined) free++;
        else {
          fixed.push([i, sitting.letter]);
          spanMask |= 1 << (sitting.letter.charCodeAt(0) - 65);
        }
        if (live.has(key)) touchesLive = true;
      }

      // A span with no empty square at all is still worth reading: laying a
      // tile on a letter is a move here, and changing one letter of a word
      // that is already on the board is one of the commonest.
      if (blockedSquare || !touchesLive || free > tiles) continue;
      if (free === 0 && fixed.length === 0) continue;

      /*
       * With letters in the span, ask which words have them there — and also
       * which words have all but one of them.
       *
       * Tiles may be laid on tiles here, so a word that disagrees with the
       * board in one place is a move, not a mismatch: CATS with an O on the A
       * is COTS. Asking only for words that match the board exactly quietly
       * ruled every such move out before `fit` could weigh it, which is why
       * the bot never once played on top of anything.
       *
       * One square, not several: covering two letters at once is legal but
       * rare, and the pool for it grows with the square of the letters in the
       * span. The cap is what keeps this affordable.
       */
      const pool =
        fixed.length > 0 ? withOneCovered(index, fixed, rackPool) : rackPool;

      for (const i of pool) {
        // Every letter the word needs must be in the rack, unless a blank can
        // stand in. Cheapest rejection there is, so it goes first.
        if (!anyLetter && (index.masks[i]! & ~(rackMask | spanMask)) !== 0) continue;

        const laid = fit(board, span, index.words[i]!, hand);
        if (laid === null) continue;

        const legality = validateTurn(board, laid.placements, dictionary, {
          width: size,
          height: size,
          blocked: shape.blocked,
          centre: shape.centre,
        });
        if (!legality.ok) continue;

        const score = value(board, laid.placements);
        found.push({ placements: laid.placements, score });
      }
    }
  }

  found.sort((a, b) => b.score - a.score);

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
      value,
      { maxLength: options.maxLength },
    );

    return { ...move, score: move.score - ahead.weight * (reply?.score ?? 0) };
  });

  // Re-ranked by what each move nets, with the rest of the list behind them.
  looked.sort((a, b) => b.score - a.score);
  return [...looked, ...found.slice(ahead.breadth ?? 6)];
}
