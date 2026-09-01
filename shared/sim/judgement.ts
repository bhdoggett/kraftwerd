/**
 * What a move leaves behind, priced.
 *
 * The rest of the search asks what a turn collects. This asks the other half of
 * the question -- what the board looks like when it is handed over -- because
 * "completer takes it" (design.md §4.4) makes that half most of the skill. A
 * block left one tile short is not a near miss, it is a gift.
 */
import { GAME, STACK_CAP } from "../config.js";
import { cellKey, type Board } from "../engine/board.js";
import type { Placement } from "../engine/score.js";
import type { BoardShape } from "../boards.js";

export interface ExposureWeights {
  /** Per k^2, for a block left one tile from complete. */
  nearBlock: number;
  /** Per letter, for a word left extendable. */
  openRun: number;
  /** Per tile left able to be stacked on. */
  stackable: number;
}

/**
 * Starting weights, to be tuned in the simulator rather than trusted.
 *
 * A donated 2x2 costs about 2.4 against a move, which is roughly what it is
 * worth to take one. These exist so the first measurement has something to
 * measure; they are not claims.
 */
export const DEFAULT_EXPOSURE: ExposureWeights = {
  nearBlock: 0.6,
  openRun: 0.15,
  stackable: 0.1,
};

/**
 * What a move leaves for the next player, in points they can expect to take.
 *
 * A greedy player takes the most on offer and hands the board over however
 * open it leaves things -- which in this game is most of the mistake, because
 * "completer takes it" means a block one tile short is simply a gift. Reading
 * that costs nothing here: exposure is countable geometry, not the fuzzy
 * judgement it would be in a game with premium squares. There is no square
 * whose value depends on which letter lands on it and no rack to guess at --
 * a gap in a k x k pays k^2 to whoever fills it, an open-ended run pays its own
 * length, and both are read straight off the grid. So what would elsewhere be
 * a search is here three loops over a few dozen cells.
 *
 * Deliberately no `applyPlacements`. This runs for every candidate in a list
 * that can be hundreds long, and copying the board map each time would cost
 * more than the search that produced them; an overlay of the placements over
 * the old board answers exactly the same questions.
 *
 * Only what the move touched is examined. Anything further away was already
 * exposed before the move and is not this move's doing -- the same locality
 * `newSquareBlocks` in shared/engine/squares.ts relies on.
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

  // Blocks one tile from complete, counted once each.
  const seen = new Set<string>();
  const maxK = Math.min(4, size);
  for (const p of placements) {
    for (let k = 2; k <= maxK; k++) {
      for (let j = 0; j < k; j++) {
        for (let i = 0; i < k; i++) {
          const ox = p.x - i;
          const oy = p.y - j;
          if (ox < 0 || oy < 0 || ox + k > size || oy + k > size) continue;
          const id = `${ox},${oy},${k}`;
          if (seen.has(id)) continue;
          seen.add(id);

          let gaps = 0;
          let blocked = false;
          for (let dy = 0; dy < k && !blocked; dy++) {
            for (let dx = 0; dx < k; dx++) {
              if (shape.blocked.has(cellKey(ox + dx, oy + dy))) {
                blocked = true;
                break;
              }
              if (!filled(ox + dx, oy + dy)) gaps++;
            }
          }

          if (!blocked && gaps === 1) penalty += w.nearBlock * k * k;
        }
      }
    }
  }

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

  // Tiles this move leaves able to be built on, for a stacking bonus.
  for (const p of placements) {
    const depth = (before.get(cellKey(p.x, p.y))?.stacked ?? 0) + 1;
    if (depth < STACK_CAP) penalty += w.stackable;
  }

  return penalty;
}

/** What a blank is worth keeping, so spending one has to beat it. */
export const DEFAULT_BLANK_RESERVE = 8;

/**
 * What spending a blank costs beyond the tiles it lays.
 *
 * The old rule spent a blank only when nothing else could be played at all,
 * which is not restraint but paralysis: a blank that closes a 3x3 is worth
 * nine points and was never once spent on one. A price says the same thing
 * properly -- hold it while something better is still likely to come along.
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
 *
 * The default reserve is about what closing a 2x2 pays, so early on a blank is
 * spent for something square-shaped or not at all.
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
