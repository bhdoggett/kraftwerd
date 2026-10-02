/**
 * What a move leaves behind, priced.
 *
 * The rest of the search asks what a turn collects. This asks the other half of
 * the question -- what the board looks like when it is handed over -- because
 * "completer takes it" (design.md §4.4) makes that half most of the skill. A
 * block left one tile short is not a near miss, it is a gift.
 */
import { GAME, SQUARE_BONUS } from "../config.js";
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
  /** Per letter, for a word left extendable. */
  openRun: number;
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
 * Opening a multiplier square to the next player is not charged at all. It
 * was, at 2 a point above one -- 2 for an x2, 6 for an x4 -- until bots were
 * seated against each other with and without it: over 40 games each, a bot
 * charging nothing beat one charging 2 by 26 to 14, about 9 points a game,
 * and charging 1 did no better than nothing. It made the bot play small to
 * guard squares the next player usually could not use, and pass up the long
 * words through multipliers that score. Measure before bringing it back.
 *
 * Nothing is charged for a tile left able to be stacked on. There was a weight
 * for it, kept at 0: at a stack cap of two it is true of every tile laid on an
 * empty square and false of every one that stacks, so it separated nothing.
 */
export const DEFAULT_EXPOSURE: ExposureWeights = {
  nearBlock: 0.5,
  openRun: 0.15,
};

/**
 * What a move leaves for the next player, in points they can expect to take.
 *
 * A greedy player takes the most on offer and hands the board over however
 * open it leaves things -- which in this game is most of the mistake, because
 * "completer takes it" means a block one tile short is simply a gift. Reading
 * that costs nothing here: exposure is countable geometry. No letter is worth
 * more than another and there is no rack to guess at -- a 3x3 gap pays
 * SQUARE_BONUS to whoever fills it and an open-ended run pays its own length,
 * both read straight off the grid. So what would elsewhere be a search
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
