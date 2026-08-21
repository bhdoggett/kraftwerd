import type { Board } from "../engine/board.js";
import { cellKey } from "../engine/board.js";
import type { Placement } from "../engine/score.js";
import { scoreTurn } from "../engine/score.js";

/** The four letters worth arguing about. */
export const RARE = "JQXZ";

export type Multiplier = "none" | "first" | "always";

export interface Variant {
  name: string;
  /** Draw from a finite pool rather than an endless weighted stream. */
  bag: number | null;
  multiplier: Multiplier;
  /** Four premium squares, doubling the turn that first reaches each. */
  premium: boolean;
  /** Board size, to see whether play is running out of room. */
  size?: number;
}

export interface TurnValue {
  score: number;
  /** Rare letters this turn doubled for. */
  doubled: string[];
}

/**
 * What a turn is worth under a variant.
 *
 * A rare letter doubles the turn, and two of them double it twice: the point
 * is to make holding a Q feel like an opportunity rather than a dead tile, and
 * halving the reward for the second one would be arguing with that.
 *
 * "first" counts a letter only the first time it is played in the game — the
 * prize goes to whoever gets there, which is a race. "always" makes it a
 * standing property of the letter, which is a different game: hold the Q,
 * play it repeatedly, and the board fills with Zs.
 */
export function turnValue(
  board: Board,
  placements: readonly Placement[],
  variant: Variant,
  claimed: ReadonlySet<string>,
  size = 15,
  premiumTaken: ReadonlySet<string> = new Set(),
): TurnValue {
  const base = scoreTurn(board, placements).total;

  // A premium square doubles the turn that first covers it, whatever it
  // spells. Stacks with the letter prize: reaching a corner with a Z on the
  // way is the play the whole idea is fishing for.
  const premiums = variant.premium
    ? premiumsClaimed(placements, size, premiumTaken).length
    : 0;

  if (variant.multiplier === "none") {
    return { score: base * 2 ** premiums, doubled: [] };
  }

  const doubled: string[] = [];
  for (const p of placements) {
    // A blank standing for a Z is not a Z: it scores nothing, and letting it
    // claim the prize would make blanks the way to farm multipliers.
    if (p.isBlank || !RARE.includes(p.letter)) continue;
    if (variant.multiplier === "first" && claimed.has(p.letter)) continue;
    doubled.push(p.letter);
  }

  // Under "first", playing two Zs in one turn is still one prize.
  const distinct = variant.multiplier === "first" ? [...new Set(doubled)] : doubled;
  return { score: base * 2 ** (distinct.length + premiums), doubled: distinct };
}

/**
 * Premium squares: four rewards on an otherwise plain board.
 *
 * Squares rather than pre-placed tiles, which is a smaller change than it
 * sounds: tiles sitting alone in the corners would be four islands, and the
 * rules require the board to be one connected mass, so nothing could ever be
 * played. A square is just a place worth reaching, and the game still starts
 * in the middle and grows outwards.
 *
 * The fourth square in from each corner, counting the corner itself as the
 * first: far enough out that reaching one is a few turns' work, symmetric so
 * nobody starts nearer than anyone else.
 */
export function premiumCells(size: number, inset = 3): string[] {
  const near = inset;
  const far = size - 1 - near;
  return [
    cellKey(near, near),
    cellKey(far, near),
    cellKey(near, far),
    cellKey(far, far),
  ];
}

/**
 * Premium squares this turn covers that nobody had covered before.
 *
 * Once only: the prize is for getting there first, so a square that has been
 * taken is an ordinary square for the rest of the game.
 */
export function premiumsClaimed(
  placements: readonly Placement[],
  size: number,
  taken: ReadonlySet<string>,
): string[] {
  return premiumCells(size).filter(
    (cell) => !taken.has(cell) && placements.some((p) => cellKey(p.x, p.y) === cell),
  );
}
