import { describe, expect, test } from "vitest";
import { makeBoard } from "../engine/board";
import { applyPlacements } from "../engine/legality";
import type { Placement } from "../engine/score";
import { turnValue, type Variant } from "./variants";

const PLAIN: Variant = { name: "plain", bag: null, multiplier: "none" };

/**
 * What a turn is worth, and the two arguments that decide it.
 *
 * `turnValue` is how the simulator scores every turn of every game, and both
 * of its board arguments were once wrong: the pre-move board where the
 * after-board belongs, and no before-board at all. Neither mistake throws --
 * they just quietly return a smaller or larger number -- so nothing but a test
 * that names the expected total will catch them coming back.
 */
describe("what a turn is worth", () => {
  test("a play scores the tiles it just laid", () => {
    // OATS across the middle, and a C in front of it.
    const board = makeBoard([..."OATS"].map((letter, i) => ({
      x: 6 + i, y: 7, letter, isBlank: false, stacked: 1,
    })));
    const placements: Placement[] = [{ x: 5, y: 7, letter: "C", isBlank: false }];
    const after = applyPlacements(board, placements);

    /*
     * COATS, five letters, five points.
     *
     * The C goes in front deliberately. Handed the *pre-move* board instead of
     * the after-board, the run through the new tile is walked on a board the
     * new tile is not on -- so it stops dead at the C's own square, finds no
     * run at all, and the turn falls back to scoring one lone letter. One
     * point where five are owed, which is roughly what the simulator reported
     * for every turn it played until this argument was put right.
     */
    expect(turnValue(after, placements, PLAIN, new Set(), board).score).toBe(5);
  });

  test("a tile laid on a tile collects its stack bonus, and pays no square twice", () => {
    /*
     * A finished 2x2, all four words good:
     *
     *        7    8
     *   7    A    T      AT across, AT down column 7
     *   8    T    O      TO across, TO down column 8
     *
     * An I on the A leaves both of its words good (IT and IT) and the block
     * exactly as full as it already was.
     */
    const board = makeBoard([
      { x: 7, y: 7, letter: "A", isBlank: false, stacked: 1 },
      { x: 8, y: 7, letter: "T", isBlank: false, stacked: 1 },
      { x: 7, y: 8, letter: "T", isBlank: false, stacked: 1 },
      { x: 8, y: 8, letter: "O", isBlank: false, stacked: 1 },
    ]);
    const placements: Placement[] = [{ x: 7, y: 7, letter: "I", isBlank: false }];
    const after = applyPlacements(board, placements);

    /*
     * IT across and IT down is 4, and the second tile on the square is 2:
     * 6 in total. Without the before-board the tile underneath is invisible,
     * and both halves go wrong at once -- the stack pays nothing, and a block
     * that was already somebody's looks newly closed and pays 4 again.
     */
    expect(turnValue(after, placements, PLAIN, new Set(), board).score).toBe(6);
  });
});
