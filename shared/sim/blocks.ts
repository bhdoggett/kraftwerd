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
 * posed; the problem as posed is mostly empty.
 *
 * It used to be narrower than that: it could only fill empty squares, so a
 * block whose standing letters did not happen to fit a word square was out of
 * reach however good the rack was. A turn here may now write over a standing
 * tile as well, at one rack tile and one unit of the `reletter` budget each.
 *
 * What that cannot do is pay for rearranging a finished block. `newSquareBlocks`
 * counts a block only where it is filled after and was not filled before, so a
 * full block earns nothing whatever its letters become. Re-lettering pays only
 * beside a gap: rewrite a standing letter *and* close what is left open, and a
 * square that was not complete is. Both of `candidateBlocks`' rejections
 * therefore stand -- the full block, and the block with more gaps than tiles --
 * and the budget a block can actually afford is `min(reletter, tiles - gaps)`.
 *
 * So a `Candidate` names two kinds of square, and they are kept apart because
 * the solver treats them differently: every one of `gaps` must be filled, and
 * any of `rewritable` may be changed. A standing tile is rewritable only below
 * STACK_CAP -- one already stacked on cannot be touched at all -- and the
 * stacking rules are load-bearing here again as a result: `solveBlock` bars a
 * blank from filling a stack, which at a cap of 2 bars it from every rewrite.
 * A cap of 3 would relax that predicate rather than need new code. Whatever any
 * of this offers, `validateTurn` still has the last word on it.
 */
import { STACK_CAP } from "../config.js";
import { cellKey, type Board, type Coord, type Tile } from "../engine/board.js";
import { applyPlacements, validateTurn, type Dictionary } from "../engine/legality.js";
import type { Placement } from "../engine/score.js";
import type { BoardShape } from "../boards.js";
import type { WordIndex } from "./words.js";
import { moveKey, type Hand, type Move, type ValueFn } from "./components.js";

export interface Candidate {
  k: number;
  x: number;
  y: number;
  /** Squares with nothing on them. A turn has to fill every one, or the block
   * is not finished and pays nothing. */
  gaps: Coord[];
  /**
   * Standing tiles a turn is allowed to write over, at a rack tile each.
   *
   * Deliberately not merged with `gaps`: the two are not the same obligation.
   * Missing one of these costs nothing, and a turn that changes none of them is
   * exactly the turn the solver used to offer. Only the tiles below STACK_CAP
   * are listed -- a square that has had its second tile is settled for good.
   */
  rewritable: Coord[];
}

/** How far the block pass may go. Every field optional; this module owns the
 * defaults, and `MoveOptions.squares` in bot.ts forwards this whole shape. */
export interface BlockOptions {
  maxK?: number;
  maxBlocks?: number;
  nodeLimit?: number;
  /**
   * How many standing tiles one turn may write over. 0 is the fill-only solver
   * this started as.
   *
   * Two by default. One reaches most of what re-lettering is for -- a single
   * wrong letter standing between a rack and a square -- and the second is what
   * makes a block with two wrong letters reachable at all; past that the tiles
   * a rack would have to spend on rewrites are tiles it no longer has for gaps,
   * so the budget stops paying before it stops costing.
   */
  reletter?: number;
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
 *
 * That cut, and not `reletter`, is what decides whether re-lettering ever gets
 * to do anything. Measured over 208 turns played on the live bot's own options,
 * the twelve blocks at the front are the ones with fewest gaps, which is to say
 * the ones with the most standing letters -- and a rewrite budget of two cannot
 * rescue six standing letters that do not fit a word square. At twelve, budget 2
 * found five extra turns and no extra 3x3; at forty it found a hundred and
 * seven, and one more 3x3. The blocks re-lettering pays on are the ones with
 * room in them, and this ordering puts those last.
 *
 * Ordering by fewest gaps *across* sizes was measured too, and is worse: it
 * fills the twelve with 2x2s, which re-letters happily and closes fewer 3x3s
 * than before. k first is right; the cap is what would have to move.
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
        const gaps: Coord[] = [];
        const rewritable: Coord[] = [];
        let blocked = false;
        let holdsTile = false;

        for (let j = 0; j < k && !blocked; j++) {
          for (let i = 0; i < k; i++) {
            const key = cellKey(x + i, y + j);
            if (shape.blocked.has(key)) {
              blocked = true;
              break;
            }
            const tile = board.get(key);
            if (tile === undefined) gaps.push({ x: x + i, y: y + j });
            else {
              holdsTile = true;
              // A square holds STACK_CAP tiles over its whole life. At the cap
              // nothing may land on it again, so its letter is final.
              if (tile.stacked < STACK_CAP) rewritable.push({ x: x + i, y: y + j });
            }
          }
        }

        /*
         * Already finished pays nothing; more gaps than tiles cannot be closed.
         *
         * Both survive re-lettering. A filled block is filled before and after,
         * so `newSquareBlocks` never counts it however its letters change, and
         * a rewrite costs a tile of its own rather than saving one -- a block
         * needing every tile in the rack to close its gaps can afford none.
         */
        if (blocked || gaps.length === 0 || gaps.length > tiles) continue;

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

        found.push({ k, x, y, gaps, rewritable });
      }
    }
  }

  // Biggest payoff first, and among equals the ones needing fewest tiles.
  found.sort((a, b) => b.k - a.k || a.gaps.length - b.gaps.length);
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
 * the dictionary once no letter of it can still change: if the square just past
 * either end is a gap this turn still intends to fill, the word is not finished
 * being written, and judging it now would reject the very squares this solver
 * exists to find. A square *inside* the run counts the same way once a turn can
 * re-letter: a standing tile the solver has not yet decided about is a letter
 * that may still become another one, and judging around it would throw away
 * every solution that changes it. So `pending` is consulted at both ends and at
 * every cell between them.
 *
 * Every run of the finished turn still gets judged, exactly once -- at the
 * moment the last square of it this turn may touch is decided. A run holding
 * nothing this turn touches goes unjudged, and rightly: it was on the board
 * before, so it was already a word.
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
  let undecided = false;
  let ex = sx;
  let ey = sy;
  for (let key = cellKey(ex, ey), tile = provisional.get(key); tile !== undefined;) {
    word += tile.letter;
    if (pending.has(key)) undecided = true;
    ex += dx;
    ey += dy;
    key = cellKey(ex, ey);
    tile = provisional.get(key);
  }

  const settled = !undecided
    && !pending.has(cellKey(sx - dx, sy - dy)) && !pending.has(cellKey(ex, ey));
  return { word, settled };
}

/** One square of a block the solver may write on, and what is under it. */
interface Choice {
  x: number;
  y: number;
  key: string;
  /** The tile standing here. Absent for a gap, which must be filled. */
  standing?: Tile;
}

/**
 * The squares of a block a turn may write on, in reading order.
 *
 * Reading order rather than gaps-then-rewrites, and that is load-bearing: the
 * pruning in `solveBlock` fires when a run has no undecided square left in it,
 * so taking a block row by row settles each row's word as that row finishes.
 * Grouping the rewrites at the end would leave every row undecided until the
 * very bottom of the search and prune nothing at all.
 *
 * With no budget the rewrites are left out entirely, which makes the walk the
 * gaps-only walk this module started as, node for node.
 */
function choices(board: Board, block: Candidate, budget: number): Choice[] {
  const gaps = new Set(block.gaps.map((c) => cellKey(c.x, c.y)));
  const rewritable = budget > 0
    ? new Set(block.rewritable.map((c) => cellKey(c.x, c.y)))
    : new Set<string>();

  const cells: Choice[] = [];
  for (let j = 0; j < block.k; j++) {
    for (let i = 0; i < block.k; i++) {
      const x = block.x + i;
      const y = block.y + j;
      const key = cellKey(x, y);
      if (gaps.has(key)) cells.push({ x, y, key });
      else if (rewritable.has(key)) cells.push({ x, y, key, standing: board.get(key) });
    }
  }
  return cells;
}

/**
 * Every way this rack can finish this block.
 *
 * Plain backtracking over the squares the turn may write on, checking each word
 * the moment it is finished rather than at the end -- a wrong letter in the top
 * row is caught before the bottom row is ever tried, which is what keeps a
 * nine-cell search from being a nine-deep one. `nodeLimit` is the backstop for
 * the block where that is not enough: an unusually open block with a rack of
 * common letters can branch further than the turn can afford, and a bot that
 * thinks for a minute is worse than one that misses a square.
 *
 * A gap has to be filled. A standing tile is a genuine three-way choice --
 * leave it, or spend a tile on any letter but the one already there -- and
 * `budget` caps how many of those a single turn may take, because otherwise a
 * rack of seven would happily repaint a whole 3x3 for the price of the square.
 */
function solveBlock(
  board: Board,
  block: Candidate,
  hand: Hand,
  dictionary: Dictionary,
  nodeLimit: number,
  budget: number,
): Placement[][] {
  const solutions: Placement[][] = [];
  const provisional = new Map(board);
  const placements: Placement[] = [];
  let nodes = 0;

  const cells = choices(board, block, budget);

  /*
   * Squares not yet decided, and how many of them must be filled, as at each
   * step. Worked out once rather than per node: the order never changes, so
   * neither do these.
   */
  const pendingFrom: Set<string>[] = cells.map((_, at) =>
    new Set(cells.slice(at + 1).map((c) => c.key)),
  );
  const gapsAfter: number[] = cells.map(
    (_, at) => cells.slice(at + 1).filter((c) => c.standing === undefined).length,
  );

  const walk = (at: number, letters: readonly string[], blanks: number, left: number) => {
    if (nodes++ > nodeLimit) return;

    if (at === cells.length) {
      solutions.push(placements.map((p) => ({ ...p })));
      return;
    }

    const { x, y, key, standing } = cells[at];
    const pending = pendingFrom[at];

    const ok = () => {
      for (const [dx, dy] of AXES) {
        const { word, settled } = runAt(provisional, x, y, dx, dy, pending);
        if (!settled || word.length < 2) continue;
        if (!dictionary.has(word)) return false;
      }
      return true;
    };

    const tryLetter = (
      letter: string,
      isBlank: boolean,
      rest: readonly string[],
      blanksLeft: number,
      budgetLeft: number,
    ) => {
      const priorStack = standing?.stacked ?? 0;
      provisional.set(key, { letter, isBlank, stacked: priorStack + 1 });
      placements.push({ x, y, letter, isBlank });

      if (ok()) walk(at + 1, rest, blanksLeft, budgetLeft);

      placements.pop();
      if (standing === undefined) provisional.delete(key);
      else provisional.set(key, standing);
    };

    if (standing !== undefined) {
      /*
       * Leaving it is a decision like any other, and settles this square: a run
       * whose last undecided letter this was is judged here and now.
       */
      if (ok()) walk(at + 1, letters, blanks, left);

      // A rewrite costs a tile, and the gaps still to come each cost one too.
      // Spending the last of them here would leave the block open, which pays
      // nothing whatever it spells.
      if (left === 0 || letters.length + blanks <= gapsAfter[at]) return;
    }

    const tried = new Set<string>();
    const spent = standing === undefined ? left : left - 1;
    for (let i = 0; i < letters.length; i++) {
      const letter = letters[i];
      if (tried.has(letter)) continue;
      tried.add(letter);
      // Laying a letter back on itself changes nothing and is not a turn.
      if (letter === standing?.letter) continue;
      tryLetter(letter, false, [...letters.slice(0, i), ...letters.slice(i + 1)], blanks, spent);
    }

    /*
     * A blank may stand for anything -- subject to the rule as written, not as
     * it happens to read today. A blank may not be the tile that fills a stack,
     * which at STACK_CAP 2 bars it from every standing tile and from none of
     * the gaps. Raise the cap and the same line lets a blank land on a tile
     * that is not yet the last one.
     *
     * On a gap this is the one place in the search where a blank does its real
     * work. Elsewhere it substitutes for a letter in a word the rack nearly
     * spells, which is worth a few points. Here it closes a square the rack
     * could not close at all, which is worth k^2.
     */
    const priorStack = standing?.stacked ?? 0;
    const barred = priorStack + 1 >= STACK_CAP && priorStack > 0;
    if (blanks > 0 && !barred) {
      for (const letter of ALPHABET) {
        if (tried.has(letter) || letter === standing?.letter) continue;
        tryLetter(letter, true, letters, blanks - 1, spent);
      }
    }
  };

  walk(0, [...hand.letters], hand.blanks, budget);
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
  options: BlockOptions = {},
): Move[] {
  const tiles = hand.letters.length + hand.blanks;
  const blocks = candidateBlocks(board, shape, size, tiles, options.maxK ?? 4)
    .slice(0, options.maxBlocks ?? 12);
  const reletter = options.reletter ?? 2;

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
    /*
     * What this block can actually afford. Closing it costs a tile per gap and
     * a tile per rewrite, so the rewrites a rack can pay for are whatever is
     * left over once the gaps are covered -- and a block that needs the whole
     * rack to close is searched exactly as it was before any of this.
     */
    const budget = Math.min(reletter, tiles - block.gaps.length);
    for (const placements of solveBlock(board, block, hand, dictionary,
                                        options.nodeLimit ?? 20_000, budget)) {
      const key = moveKey(placements);
      if (seen.has(key)) continue;
      seen.add(key);

      // The solver only checks the runs it closes. The full rules -- buried
      // words, connectivity, the blank rules -- have the last word. Burying a
      // word whole stopped being hypothetical when re-lettering arrived: two
      // rewrites can cover a two-letter word entirely, and this is what
      // catches it.
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
    .map((block) => block.gaps[0]);

  /*
   * No stacking check, and still none: this reads `gaps`, never `rewritable`,
   * and a gap is a square with nothing on it. So the prior stack is zero and a
   * blank is never the tile filling a stack. `solveBlock` is where that rule
   * became live, because that is where a turn can land on a standing tile;
   * writing the predicate here as well would put back one that cannot fire.
   */
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
