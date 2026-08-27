import type { Board } from "../engine/board.js";
import type { Placement } from "../engine/score.js";
import { scoreTurn } from "../engine/score.js";

/** The four letters worth arguing about. */
export const RARE = "JQXZ";

export type Multiplier = "none" | "first" | "always";

export interface Variant {
  name: string;
  /** Draw from a finite pool rather than an endless weighted stream. */
  bag: number | null;
  /**
   * The bag's exact contents, letter by letter.
   *
   * Without this a variant can only scale one set of weights to a size, which
   * ties "a bigger bag" to "the same mixture" — and the question worth asking
   * is what more vowels do, at either size.
   */
  weights?: Readonly<Record<string, number>>;
  multiplier: Multiplier;
  /** Board size, to see whether play is running out of room. */
  size?: number;
  /**
   * How heavily a player weighs what a move leaves for the next one. Zero, or
   * absent, is the greedy player: most points now, whatever it opens up.
   */
  lookahead?: number;
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
): TurnValue {
  const base = scoreTurn(board, placements).total;


  if (variant.multiplier === "none") return { score: base, doubled: [] };

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
  return { score: base * 2 ** distinct.length, doubled: distinct };
}

