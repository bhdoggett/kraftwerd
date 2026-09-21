import { SQUARE_BONUS } from "../../shared/config";

/** One row of the square-bonus table: a size, how many, and what they paid. */
export interface BreakdownRow {
  size: string;
  count: number;
  total: number;
}

/**
 * The square bonus, split by the size of block that earned it.
 *
 * Out of the game screen so the arithmetic has somewhere to be tested. It had
 * been computing a block's worth as `size * size`, which was right when a
 * k x k paid k^2 and wrong from the moment squares went flat: a completed 3x3
 * showed as 9 while the turn's total collected `SQUARE_BONUS` -- 33 -- for
 * it. The table exists to explain the total, so a table that disagrees with
 * it is worse than no table.
 *
 * Grouping by size survives the change even though only one size pays today
 * (`SCORING_SQUARE_SIZE`). The rows come from `TurnScore.squares`, which
 * carries a side length per completed block, and reading the number off the
 * data rather than assuming it means this keeps telling the truth if a second
 * paying size ever arrives.
 */
export function squareBreakdown(squares: readonly number[]): BreakdownRow[] {
  const bySize = new Map<number, number>();
  for (const size of squares) bySize.set(size, (bySize.get(size) ?? 0) + 1);

  return [...bySize.keys()]
    .sort((a, b) => a - b)
    .map((size) => {
      const count = bySize.get(size)!;
      return {
        size: `${size}×${size}`,
        count,
        total: count * SQUARE_BONUS,
      };
    });
}
