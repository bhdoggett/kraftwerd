/**
 * The block solver: turns that are legal only as a whole.
 *
 * Every other stage of the search composes plays that each stand up on their
 * own -- a span the single-span search validated, or a sequence of them the
 * chained search stacked up. Most word squares are reachable that way, and
 * chaining reaches them: a block whose remaining gaps lie in one line is an
 * ordinary span, and a block whose gaps can be filled a legal play at a time
 * is exactly what chaining is for.
 *
 * What is left over is the block whose gaps are non-collinear *and*
 * individually illegal -- the four corners of a 3x3, where one corner alone
 * spells a two-letter fragment that is not a word, so there is no legal first
 * tile and no order in which to play them one at a time. Those are rare (see
 * the count below), and this is the only stage that can reach them at all.
 *
 * So the squares are gone at directly. That is affordable because k is small
 * and the shortlist is capped. A 3x3 is nine cells, of which the board usually
 * supplies most, so the backtracking runs a few gaps deep over a seven-letter
 * rack rather than over the whole alphabet across a whole board. A mid-game
 * board offers around a hundred reachable unfinished blocks, which is not a
 * handful, so `maxBlocks` takes the front of the ordering and the rest go
 * unexamined; measured, the whole pass is about 1% of the search's time.
 *
 * What it is worth is a separate question from whether it is right. Measured
 * over 130 turns of real play it offered five turns closing a 3x3 to the
 * chained search's eighty-six, and every one of the five laid three tiles or
 * fewer -- the near-complete blocks chaining already reaches. Squares with
 * four or more gaps ask a seven-tile rack to spell six interlocking words at
 * once, and real racks do not. The solver is complete for the problem as
 * posed; the problem as posed is mostly empty. Its ceiling is that it may only
 * fill empty squares, so a block whose standing letters do not happen to fit a
 * word square is out of reach however good the rack is.
 *
 * That ceiling is `empties`, and it is the one thing to change if STACK_CAP
 * ever rises above 2. `candidateBlocks` records a square as a gap only when
 * the board has nothing on it, and every later stage -- `solveBlock`,
 * `blankMoves` -- fills gaps and nothing else. So no stacking predicate
 * anywhere below is doing any work, and none is written: a cap of 3 would let
 * a tile close a block by landing on another, and reaching that play means
 * widening what counts as a gap, not relaxing a test further down. Whatever
 * `empties` offers, `validateTurn` still rules on.
 */
import { cellKey, type Board, type Coord } from "../engine/board.js";
import { applyPlacements, validateTurn, type Dictionary } from "../engine/legality.js";
import type { Placement } from "../engine/score.js";
import type { BoardShape } from "../boards.js";
import type { WordIndex } from "./words.js";
import { moveKey, type Hand, type Move, type ValueFn } from "./components.js";

export interface Candidate {
  k: number;
  x: number;
  y: number;
  empties: Coord[];
}

/**
 * Blocks worth trying to finish this turn, best payoff first.
 *
 * Squares pay k^2 and nest -- a finished 3x3 also closes four 2x2s -- so the
 * biggest block goes first, and among blocks of a size the one asking for
 * fewest tiles, since that is both the likeliest to close and the cheapest to
 * search. The list is then cut by the caller, and the cut bites: a mid-game
 * board yields around a hundred of these, of which `maxBlocks` sees twelve.
 * Raising the cap to take all of them was measured and bought nothing -- more
 * turns offered, not one of them better than what the ranked list already
 * held -- so the cut stays where it costs least.
 */
export function candidateBlocks(
  board: Board,
  shape: BoardShape,
  size: number,
  tiles: number,
  maxK: number,
): Candidate[] {
  const found: Candidate[] = [];

  for (let k = 2; k <= maxK; k++) {
    for (let y = 0; y + k <= size; y++) {
      for (let x = 0; x + k <= size; x++) {
        const empties: Coord[] = [];
        let blocked = false;
        let holdsTile = false;

        for (let j = 0; j < k && !blocked; j++) {
          for (let i = 0; i < k; i++) {
            const key = cellKey(x + i, y + j);
            if (shape.blocked.has(key)) {
              blocked = true;
              break;
            }
            if (board.has(key)) holdsTile = true;
            else empties.push({ x: x + i, y: y + j });
          }
        }

        // Already finished pays nothing; more gaps than tiles cannot be closed.
        if (blocked || empties.length === 0 || empties.length > tiles) continue;

        if (board.size === 0) {
          /*
           * Nothing is on the board at all, so there is nothing to join: the
           * block is the opening play, and an opening play covers the centre.
           * Asked before the reachability test below, which an empty board can
           * never satisfy and which would otherwise throw the opening away.
           */
          const centre = shape.centre;
          const inside = centre.x >= x && centre.x < x + k && centre.y >= y && centre.y < y + k;
          if (!inside) continue;
        } else if (!holdsTile && !touchesBoard(board, x, y, k, size)) {
          /*
           * The filled block must join the mass. A block holding a tile already
           * does; one that does not needs a tile against its edge, since a
           * k x k of new tiles is itself connected and only needs one point of
           * contact. A shortlisting test, not a ruling: it reasons about the
           * block being filled rather than about any particular turn, and it
           * takes the board before the turn for one mass without checking.
           * `validateTurn` still has the last word on every solution.
           */
          continue;
        }

        found.push({ k, x, y, empties });
      }
    }
  }

  // Biggest payoff first, and among equals the ones needing fewest tiles.
  found.sort((a, b) => b.k - a.k || a.empties.length - b.empties.length);
  return found;
}

function touchesBoard(board: Board, x: number, y: number, k: number, size: number): boolean {
  for (let i = 0; i < k; i++) {
    for (const [cx, cy] of [
      [x + i, y - 1], [x + i, y + k], [x - 1, y + i], [x + k, y + i],
    ] as const) {
      if (cx < 0 || cy < 0 || cx >= size || cy >= size) continue;
      if (board.has(cellKey(cx, cy))) return true;
    }
  }
  return false;
}

const ALPHABET = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

/** Across, then down: the two directions a run can read. */
const AXES = [[1, 0], [0, 1]] as const;

/**
 * The maximal run through a cell along one axis, and whether it is settled.
 *
 * Maximal, not the k letters inside the block. A 2x2 laid against a word
 * already on the board makes a longer word than its own two letters, and it is
 * that longer word the rules read. Checking the fragment instead would offer
 * turns that look right and are not: two letters that spell something with a
 * third letter sitting next to them that spells nothing.
 *
 * Settled is the other half of the same care. A run is only worth putting to
 * the dictionary once nothing can still extend it: if the square just past
 * either end is a gap this turn still intends to fill, the word is not
 * finished being written, and judging it now would reject the very squares
 * this solver exists to find. Every run of the finished turn does get judged --
 * at the moment its last gap is filled, when both its ends are settled by
 * construction, since a pending gap at an end would have made the run longer.
 */
function runAt(
  provisional: Board,
  x: number,
  y: number,
  dx: number,
  dy: number,
  pending: ReadonlySet<string>,
): { word: string; settled: boolean } {
  let sx = x;
  let sy = y;
  while (provisional.has(cellKey(sx - dx, sy - dy))) {
    sx -= dx;
    sy -= dy;
  }

  let word = "";
  let ex = sx;
  let ey = sy;
  for (let tile = provisional.get(cellKey(ex, ey)); tile !== undefined;) {
    word += tile.letter;
    ex += dx;
    ey += dy;
    tile = provisional.get(cellKey(ex, ey));
  }

  const settled =
    !pending.has(cellKey(sx - dx, sy - dy)) && !pending.has(cellKey(ex, ey));
  return { word, settled };
}

/**
 * Every way this rack can finish this block.
 *
 * Plain backtracking over the gaps, checking each word the moment it is
 * finished rather than at the end -- a wrong letter in the top row is caught
 * before the bottom row is ever tried, which is what keeps a nine-cell search
 * from being a nine-deep one. `nodeLimit` is the backstop for the block where
 * that is not enough: an unusually open block with a rack of common letters
 * can branch further than the turn can afford, and a bot that thinks for a
 * minute is worse than one that misses a square.
 */
function solveBlock(
  board: Board,
  block: Candidate,
  hand: Hand,
  dictionary: Dictionary,
  nodeLimit: number,
): Placement[][] {
  const solutions: Placement[][] = [];
  const provisional = new Map(board);
  const placements: Placement[] = [];
  let nodes = 0;

  /*
   * Gaps still to fill, as at each step. Worked out once rather than per node:
   * the order the gaps are taken in never changes, so neither does this.
   */
  const pendingFrom: Set<string>[] = block.empties.map((_, at) =>
    new Set(block.empties.slice(at + 1).map((c) => cellKey(c.x, c.y))),
  );

  const walk = (at: number, letters: readonly string[], blanks: number) => {
    if (nodes++ > nodeLimit) return;

    if (at === block.empties.length) {
      solutions.push(placements.map((p) => ({ ...p })));
      return;
    }

    const { x, y } = block.empties[at];
    const key = cellKey(x, y);
    const pending = pendingFrom[at];

    const ok = () => {
      for (const [dx, dy] of AXES) {
        const { word, settled } = runAt(provisional, x, y, dx, dy, pending);
        if (!settled || word.length < 2) continue;
        if (!dictionary.has(word)) return false;
      }
      return true;
    };

    const tryLetter = (letter: string, isBlank: boolean, rest: readonly string[], left: number) => {
      provisional.set(key, { letter, isBlank, stacked: 1 });
      placements.push({ x, y, letter, isBlank });

      if (ok()) walk(at + 1, rest, left);

      placements.pop();
      provisional.delete(key);
    };

    const tried = new Set<string>();
    for (let i = 0; i < letters.length; i++) {
      const letter = letters[i];
      if (tried.has(letter)) continue;
      tried.add(letter);
      tryLetter(letter, false, [...letters.slice(0, i), ...letters.slice(i + 1)], blanks);
    }

    /*
     * A blank may stand for anything. No stacking rule is consulted because
     * there is no stack to consult: every gap here came from `block.empties`,
     * which holds only squares with nothing on them.
     *
     * This is the one place in the search where a blank does its real work.
     * Elsewhere it substitutes for a letter in a word the rack nearly spells,
     * which is worth a few points. Here it closes a square the rack could not
     * close at all, which is worth k^2.
     */
    if (blanks > 0) {
      for (const letter of ALPHABET) {
        if (tried.has(letter)) continue;
        tryLetter(letter, true, letters, blanks - 1);
      }
    }
  };

  walk(0, [...hand.letters], hand.blanks);
  return solutions;
}

/**
 * Turns that finish a k x k block, which the general search cannot see.
 *
 * `words` goes unused: the solver works letter by letter off the rack rather
 * than word by word out of the index, because the words it is spelling are not
 * known until the block is full. It stays in the signature so every stage of
 * the search takes the same arguments.
 */
export function blockMoves(
  board: Board,
  hand: Hand,
  dictionary: Dictionary,
  _words: WordIndex,
  shape: BoardShape,
  size: number,
  scoreOf: ValueFn,
  options: { maxK?: number; maxBlocks?: number; nodeLimit?: number } = {},
): Move[] {
  const tiles = hand.letters.length + hand.blanks;
  const blocks = candidateBlocks(board, shape, size, tiles, options.maxK ?? 4)
    .slice(0, options.maxBlocks ?? 12);

  /*
   * No `connected: true`. That shortcut asks the caller to vouch for a turn
   * that fills one unbroken straight line touching the mass, and a block is a
   * square, not a line: its gaps can sit in opposite corners with board tiles
   * between them, so the placements are not one run of anything. The
   * shortlisting in `candidateBlocks` argues that a *filled* block joins the
   * mass, but that is an argument, and the whole point of the walk is not to
   * take arguments on trust. It is run.
   */
  const bounds = {
    width: size,
    height: size,
    blocked: shape.blocked,
    centre: shape.centre,
  };

  const found: Move[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    for (const placements of solveBlock(board, block, hand, dictionary,
                                        options.nodeLimit ?? 20_000)) {
      const key = moveKey(placements);
      if (seen.has(key)) continue;
      seen.add(key);

      // The solver only checks the runs it closes. The full rules -- buried
      // words, connectivity, the blank rules -- have the last word.
      if (!validateTurn(board, placements, dictionary, bounds).ok) continue;

      const after = applyPlacements(board, placements);
      const score = scoreOf(after, placements, board);
      found.push({ placements, score, value: score });
    }
  }

  found.sort((a, b) => b.value - a.value);
  return found;
}

/**
 * Single-tile blank plays, where a blank is worth what it costs.
 *
 * A blank in the general search makes every word a candidate for every span,
 * which is why it used to be a last resort. But there is a short list of
 * squares where one tile plainly pays -- the last gap in a block -- and
 * twenty-six letters against a handful of squares is nothing. The price in
 * `blankPrice` decides whether any of them is worth taking.
 *
 * Here, rather than in a module of its own, because the shortlist is exactly
 * what `candidateBlocks` already computes.
 */
export function blankMoves(
  board: Board,
  hand: Hand,
  dictionary: Dictionary,
  shape: BoardShape,
  size: number,
  scoreOf: ValueFn,
  options: { maxK?: number; maxBlocks?: number } = {},
): Move[] {
  if (hand.blanks === 0) return [];

  const bounds = { width: size, height: size, blocked: shape.blocked, centre: shape.centre };
  const found: Move[] = [];
  const seen = new Set<string>();

  // Asking for blocks a single tile can finish names the squares directly:
  // `candidateBlocks` drops the finished ones and anything needing more than
  // the tiles it is given, so every block it returns here has exactly one gap.
  const gaps = candidateBlocks(board, shape, size, 1, options.maxK ?? 3)
    .slice(0, options.maxBlocks ?? 12)
    .map((block) => block.empties[0]);

  // No stacking check: `candidateBlocks` reports gaps, and a gap is a square
  // with nothing on it. See the note on `empties` in the module comment.
  for (const { x, y } of gaps) {
    for (const letter of ALPHABET) {
      const placements = [{ x, y, letter, isBlank: true }];
      // One square can be the last gap of a 2x2 and of a 3x3 at once.
      const key = moveKey(placements);
      if (seen.has(key)) continue;
      seen.add(key);

      if (!validateTurn(board, placements, dictionary, bounds).ok) continue;

      const after = applyPlacements(board, placements);
      const score = scoreOf(after, placements, board);
      found.push({ placements, score, value: score });
    }
  }

  return found;
}
