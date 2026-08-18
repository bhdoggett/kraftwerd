import type { Board, Coord } from "./board.js";
import { newSquares } from "./squares.js";

export interface Placement extends Coord {
  letter: string;
  isBlank: boolean;
}

export interface TurnScore {
  tilePoints: number;
  squarePoints: number;
  squares: number[];
  total: number;
}

/**
 * Score a turn against the board as it stands *after* the placement.
 *
 * 1 point per placed tile, blanks excluded; plus k^2 for every k x k block
 * the placement completed, counting nested sub-squares.
 */
export function scoreTurn(board: Board, placements: readonly Placement[]): TurnScore {
  const tilePoints = placements.filter((p) => !p.isBlank).length;
  const squares = newSquares(board, placements);
  const squarePoints = squares.reduce((sum, k) => sum + k * k, 0);

  return { tilePoints, squarePoints, squares, total: tilePoints + squarePoints };
}
