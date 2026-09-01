/**
 * The single-span search: every move that lays one straight word.
 *
 * Split out of `bot.ts` because it is called far more often than once a turn.
 * The chained search runs it once per link, and the block solver leans on it
 * too, so what it costs is multiplied by everything built on top of it.
 */
import { STACK_CAP } from "../config.js";
import { cellKey, type Board } from "../engine/board.js";
import type { Dictionary } from "../engine/legality.js";
import { applyPlacements, validateTurn } from "../engine/legality.js";
import type { Placement } from "../engine/score.js";
import type { BoardShape } from "../boards.js";
import { rackWords, withOneCovered, type WordIndex } from "./words.js";

export interface Move {
  placements: Placement[];
  /** Points the turn actually scores, by the rules. */
  score: number;
  /** score less any penalty — what ranking and difficulty read. */
  value: number;
}

/**
 * Scores a candidate turn. Called with the board *after* the placements have
 * landed (so a crossing or extended word scores in full), the placements
 * themselves, and the board *before* them (so a caller can tell what was
 * already there, e.g. for stacking bonuses).
 */
export type ValueFn = (
  after: Board,
  placements: readonly Placement[],
  before: Board,
) => number;

export interface Hand {
  letters: readonly string[];
  blanks: number;
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

/**
 * Squares worth building through: occupied, or touching something occupied.
 * On an empty board there is only one -- the centre the opening must cover.
 */
export function anchors(board: Board, shape: BoardShape, size: number): Set<string> {
  const live = new Set<string>();

  if (board.size === 0) {
    live.add(cellKey(shape.centre.x, shape.centre.y));
    return live;
  }

  for (const key of board.keys()) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    live.add(key);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size) live.add(cellKey(nx, ny));
    }
  }

  return live;
}

/**
 * A turn's identity, independent of the order its tiles were found in.
 *
 * One placement is reachable down several spans -- an S on the end of CAT
 * turns up as CATS and again as ATS -- and later the chained search and the
 * block solver each find some of the same turns a third and fourth way.
 * Without a canonical key the ranked list fills with one move wearing
 * different hats, and the difficulty bands count it repeatedly.
 */
export function moveKey(placements: readonly Placement[]): string {
  return [...placements]
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((p) => `${p.x},${p.y},${p.letter},${p.isBlank ? 1 : 0}`)
    .join("|");
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

/**
 * Every single-span move, best first, each offered once.
 *
 * `before` is the board the turn started from and is what `scoreOf` measures
 * against; it defaults to `board`, and differs only when a chained search is
 * partway through a turn and `board` already carries earlier links.
 */
export function components(
  board: Board,
  hand: Hand,
  dictionary: Dictionary,
  words: WordIndex,
  shape: BoardShape,
  size: number,
  scoreOf: ValueFn,
  options: { maxLength?: number; before?: Board },
): Move[] {
  const tiles = hand.letters.length + hand.blanks;
  const longest = Math.min(options.maxLength ?? 7, tiles + 4);
  const sortedRack = [...hand.letters].sort();
  const before = options.before ?? board;
  const found: Move[] = [];
  const seen = new Set<string>();

  const live = anchors(board, shape, size);

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

        // A turn found down an earlier span is the same turn, and validating
        // and applying it again is the bulk of what a duplicate costs.
        const key = moveKey(laid.placements);
        if (seen.has(key)) continue;
        seen.add(key);

        const legality = validateTurn(board, laid.placements, dictionary, {
          width: size,
          height: size,
          blocked: shape.blocked,
          centre: shape.centre,
          // `fit` fills every position of the span and refuses one that
          // neither overlaps nor abuts the mass, so the board it makes is the
          // old mass plus a contiguous line touching it -- one mass, without
          // walking the whole board to say so.
          connected: true,
        });
        if (!legality.ok) continue;

        const after = applyPlacements(board, laid.placements);
        const score = scoreOf(after, laid.placements, before);
        found.push({ placements: laid.placements, score, value: score });
      }
    }
  }

  found.sort((a, b) => b.value - a.value);
  return found;
}
