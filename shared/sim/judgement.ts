/**
 * What a move leaves behind, priced.
 *
 * The rest of the search asks what a turn collects. This asks the other half of
 * the question -- what the board looks like when it is handed over -- because
 * "completer takes it" (design.md §4.4) makes that half most of the skill. A
 * block left one tile short is not a near miss, it is a gift.
 */
import { GAME, SQUARE_BONUS, STACK_CAP } from "../config.js";
import { cellKey, type Board } from "../engine/board.js";
import type { Placement } from "../engine/score.js";
import type { BoardShape } from "../boards.js";
import { nearSquares } from "../engine/nearSquares.js";

export interface ExposureWeights {
  /**
   * Share of SQUARE_BONUS charged for a 3x3 left one tile from complete. A
   * share rather than the whole, because the gap still needs a letter that
   * makes both its words, and a rack that has one.
   */
  nearBlock: number;
  /**
   * Per point of multiplier above one, for a multiplier square nobody has
   * covered yet that the move brings within a word's reach (see `REACH`). An
   * x3 opened costs twice what an x2 does: the word laid across it pays that
   * much more over its plain score.
   */
  openBonus: number;
  /** Per letter, for a word left extendable. */
  openRun: number;
  /**
   * Per tile left able to be stacked on. Zero by default -- see below; it
   * means nothing at `STACK_CAP` 2.
   */
  stackable: number;
}

/**
 * Starting weights, to be tuned in the simulator rather than trusted.
 *
 * A 3x3 left one short costs half of SQUARE_BONUS, 16.5. The real gift is
 * nearer 40 -- the bonus plus the two words the last tile completes -- but
 * the gap still needs a letter both words accept, and a penalty that
 * outweighs everything on offer stops the bot playing near a block at all.
 * This used to charge 0.6 per k^2 for every size from 2x2 to 4x4, which was
 * sized for a 2x2 that paid 4 and left a 3x3 costing 5.4 against the 33 it
 * hands over. Only a 3x3 pays now (RULES_VERSION 9), so only a 3x3 is charged:
 * a 4x4 one short is already charged through the 3x3s inside it.
 *
 * An opened multiplier costs 2 a point above one -- 2 for an x2, 6 for an x4
 * -- which is about half of what a four-letter word gains across it.
 *
 * `stackable` is 0, and that is not tuning but arithmetic. The term charges a
 * placement whose square could still take another tile -- and at `STACK_CAP` 2
 * that is true of every placement on an empty square and false for every one
 * that stacks. So it is a flat per-tile tax that separates nothing, and it
 * separates nothing in the wrong direction: it charges *less* for stacking,
 * which is the aggressive move, than for playing fresh. Kept rather than
 * deleted because it starts discriminating the moment the cap rises above 2 --
 * then a tile laid on a square with room left really does leave something
 * behind, and the weight is here waiting.
 */
export const DEFAULT_EXPOSURE: ExposureWeights = {
  nearBlock: 0.5,
  openBonus: 2,
  openRun: 0.15,
  stackable: 0,
};

/**
 * How far from a standing tile, along its row or column, a multiplier square
 * counts as within reach: three empty squares, so a four-letter word from
 * that tile covers it. Longer words reach further, but a four-letter word is
 * the one a rack can nearly always find.
 */
const REACH = 3;

/**
 * What a move leaves for the next player, in points they can expect to take.
 *
 * A greedy player takes the most on offer and hands the board over however
 * open it leaves things -- which in this game is most of the mistake, because
 * "completer takes it" means a block one tile short is simply a gift. Reading
 * that costs nothing here: exposure is countable geometry. No letter is worth
 * more than another and there is no rack to guess at -- a 3x3 gap pays
 * SQUARE_BONUS to whoever fills it, an open-ended run pays its own length, an
 * uncovered multiplier pays its multiple of whatever word crosses it, and all
 * three are read straight off the grid. So what would elsewhere be a search
 * is here a few loops over a few dozen cells.
 *
 * Deliberately no `applyPlacements`. This runs for every candidate in a list
 * that can be hundreds long, and copying the board map each time would cost
 * more than the search that produced them; an overlay of the placements over
 * the old board answers exactly the same questions.
 *
 * Only what the move touched is examined. Anything further away was already
 * exposed before the move and is not this move's doing -- the same locality
 * `newSquareBlocks` in shared/engine/squares.ts relies on.
 *
 * **Read the sign before reusing this.** What it returns is a penalty only
 * because of who moves next. A block left one tile short is a gift to whoever
 * plays after you -- but part-way through a chained turn, whoever plays after
 * you is still you, and the same number is then an opportunity. `chain` in
 * chain.ts calls this to order the links it builds on, adding it where `rank`
 * subtracts it, and the geometry does not change between the two: the tile
 * that would hand a 2x2 to an opponent is the tile that sets one up for a
 * second link. Nothing here needs to know which reading is wanted, so nothing
 * here does; the caller owns the sign.
 */
export function exposure(
  before: Board,
  placements: readonly Placement[],
  shape: BoardShape,
  size: number,
  weights: Partial<ExposureWeights> = {},
): number {
  const w = { ...DEFAULT_EXPOSURE, ...weights };
  const laid = new Map(placements.map((p) => [cellKey(p.x, p.y), p]));

  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size &&
    (laid.has(cellKey(x, y)) || before.has(cellKey(x, y)));

  const open = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size &&
    !shape.blocked.has(cellKey(x, y)) && !filled(x, y);

  let penalty = 0;

  // 3x3s one tile from complete.
  penalty += w.nearBlock * SQUARE_BONUS * nearSquares(before, placements, shape, size).length;

  // Words left with a square to grow into: one tile collects the whole run.
  const walked = new Set<string>();
  for (const p of placements) {
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      let sx = p.x;
      let sy = p.y;
      while (filled(sx - dx, sy - dy)) {
        sx -= dx;
        sy -= dy;
      }

      const id = `${dx},${dy}:${sx},${sy}`;
      if (walked.has(id)) continue;
      walked.add(id);

      let length = 0;
      let ex = sx;
      let ey = sy;
      while (filled(ex, ey)) {
        length++;
        ex += dx;
        ey += dy;
      }
      if (length < 2) continue;

      const ends = (open(sx - dx, sy - dy) ? 1 : 0) + (open(ex, ey) ? 1 : 0);
      penalty += w.openRun * length * ends;
    }
  }

  /*
   * Multiplier squares nobody has covered yet, newly within a word's reach of
   * a tile this move laid. Only newly: one a standing tile already reached
   * was open before this move and is not this move's doing.
   */
  const reaches = (bx: number, by: number, has: (x: number, y: number) => boolean) => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      for (let step = 1; step <= REACH + 1; step++) {
        const x = bx + dx * step;
        const y = by + dy * step;
        if (x < 0 || y < 0 || x >= size || y >= size) break;
        if (shape.blocked.has(cellKey(x, y))) break;
        if (has(x, y)) return true;
      }
    }
    return false;
  };
  const had = (x: number, y: number) => before.has(cellKey(x, y));
  for (const [key, multiplier] of shape.bonusSquares) {
    const [bx, by] = key.split(",").map(Number) as [number, number];
    if (filled(bx, by)) continue;
    if (reaches(bx, by, filled) && !reaches(bx, by, had)) {
      penalty += w.openBonus * (multiplier - 1);
    }
  }

  // Tiles this move leaves able to be built on by the next player.
  for (const p of placements) {
    const depth = (before.get(cellKey(p.x, p.y))?.stacked ?? 0) + 1;
    if (depth < STACK_CAP) penalty += w.stackable;
  }

  return penalty;
}

/**
 * What a blank is worth keeping, so spending one has to beat it.
 *
 * Calibrated to what closing a 2x2 used to pay, back when a 2x2 paid
 * anything at all (design.md §4.2, RULES_VERSION 8): a 3x3 is the smallest
 * square that scores now, at 33, a different order of size entirely. This
 * number has not been re-measured against that -- it is still the pre-8
 * value, carried over undisturbed rather than guessed at. Whoever tunes bot
 * economics next should treat it as unverified, not as settled.
 */
const DEFAULT_BLANK_RESERVE = 8;

/**
 * What spending a blank costs beyond the tiles it lays.
 *
 * The old rule spent a blank only when nothing else could be played at all,
 * which is not restraint but paralysis: a blank that closes a 3x3 is worth
 * thirty-three points on the block alone and was never once spent on one. A
 * price says the same thing properly -- hold it while something better is
 * still likely to come along.
 *
 * The price falls as the board fills, because the chance of that something
 * falls with it. This is not a taste for tidy arithmetic: a blank is a
 * whole-game allowance (design.md §5), so its only value is the best turn it
 * still has left to be spent on, and once the game ends there are no turns
 * left. A blank still in hand at the end is worth exactly nothing, so its
 * reserve price has to reach nothing at the same moment -- `GAME.endThreshold`
 * tiles on the board -- or the bot ends games holding tiles it was charged to
 * keep. Straight-line decay in tiles placed, which is the only measure of
 * how far through a game the board is that does not need the bag.
 */
export function blankPrice(
  board: Board,
  placements: readonly Placement[],
  reserve: number = DEFAULT_BLANK_RESERVE,
): number {
  const spent = placements.filter((p) => p.isBlank).length;
  if (spent === 0) return 0;

  const left = Math.max(0, GAME.endThreshold - board.size);
  return reserve * (left / GAME.endThreshold) * spent;
}
