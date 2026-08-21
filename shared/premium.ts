import { cellKey } from "./engine/board.js";

/**
 * The four hard letters, waiting on the board for someone to reach them.
 *
 * Each sits on a square of its own, the fourth in from a corner, counting the
 * corner as the first. They are part of the board rather than tiles anyone
 * draws: you cannot play a Q, you have to build out to the one that is there.
 *
 * Whatever they help make is worth double — the word they fall in, and the
 * square they complete — which is what makes a corner worth the journey.
 */
export const PREMIUM_LETTERS = ["J", "Q", "X", "Z"] as const;

/** How far in from each corner, counting the corner square as the first. */
const INSET = 3;

export interface PremiumCell {
  x: number;
  y: number;
  letter: string;
}

/** The four squares themselves, in a fixed order: NW, NE, SW, SE. */
export function premiumSquares(size: number): { x: number; y: number }[] {
  const near = INSET;
  const far = size - 1 - near;
  return [
    { x: near, y: near },
    { x: far, y: near },
    { x: near, y: far },
    { x: far, y: far },
  ];
}

/**
 * Deal the four letters to the four squares.
 *
 * Shuffled per game, so the corner nearest you is not always the same letter
 * and an opening cannot be learnt by heart. `rng` returns a float in [0, 1);
 * pass the game's own so a board can be redealt exactly.
 */
export function premiumCells(size: number, rng: () => number = Math.random): PremiumCell[] {
  const letters = [...PREMIUM_LETTERS];
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [letters[i], letters[j]] = [letters[j]!, letters[i]!];
  }

  return premiumSquares(size).map((square, i) => ({ ...square, letter: letters[i]! }));
}

/** The premium squares as a lookup, keyed the way the board is. */
export function premiumMap(cells: readonly PremiumCell[]): ReadonlyMap<string, string> {
  return new Map(cells.map((c) => [cellKey(c.x, c.y), c.letter]));
}
