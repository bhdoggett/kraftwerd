/**
 * What the tutorial points out after a move (one entry per SCRIPT turn): a
 * short line pinned to the board square it is about, only when the player's
 * own move shows something new (other players' moves are replayed the way a
 * game replays them, and speak for themselves). The points are in the game's
 * own play panel, and a new 3×3 is outlined on the board, so a callout says
 * why, not how much.
 *
 * Every claim here was checked against factsFor(i) and tilesAfter(i): which
 * word crossed which multiplier, whose tile was stacked on, who laid most of
 * a closed 3×3. Change SCRIPT and this text has to be re-checked by hand.
 */

import { standingsAfter } from "./model";
import { PLAYER_SEAT, SCRIPT, SEAT_NAMES } from "./script";

export interface Callout {
  /** The square it points at, as `x,y`. */
  cell: string;
  text: string;
}

/** The first screen's one line. */
export const INTRO = "Learn by playing a real game. Drop each tile on its glowing ghost.";

export const CALLOUTS: readonly (readonly Callout[])[] = [
  // 1. Isolde opens: her play is replayed the way a game replays it.
  [],
  // 2. You: your first 3×3, your first blank
  [
    { cell: "8,7", text: "You closed a 3×3: +33. The last tile in takes it." },
    { cell: "9,7", text: "A blank is any letter. 3 a game, never refilled." },
  ],
  // 3. Rostam
  [],
  // 4. Isolde
  [],
  // 5. You: one ×4 multiplies two words; a long word
  [
    { cell: "13,13", text: "×4: GEM and BIOME both run through it." },
    { cell: "13,14", text: "BIOME: 5+ letters earns +5, never multiplied." },
  ],
  // 6. Rostam
  [],
  // 7. Isolde
  [],
  // 8. You: a multiplier only pays once
  [{ cell: "7,3", text: "LACEY scores every letter again. A ×3 pays once: the L used it." }],
  // 9. Rostam
  [],
  // 10. Isolde
  [],
  // 11. You: stacking; tiles in more than one place
  [
    { cell: "1,4", text: "Stacked on Rostam's L: DRILL → DRAGONS. 2 tiles a spot, at most." },
    { cell: "13,14", text: "Two places at once is fine: each touches the board." },
  ],
  // 12. Rostam
  [],
  // 13. Isolde goes out, which changes whose turn comes next.
  [{ cell: "2,8", text: "Isolde is out of tiles: she's skipped from now on." }],
  // 14. You: W on a ×3; nothing left to draw
  [
    { cell: "11,3", text: "W on a ×3: WIFE and AW both run through it." },
    { cell: "12,4", text: "The bag is empty: your rack won't refill now." },
  ],
  // 15. Rostam
  [],
  // 16. You go out
  [{ cell: "7,12", text: "Your hand is empty: you're out." }],
  // 17. Rostam's last tile ends the game: the dialog says so.
  [],
];

const finalSeats = [...standingsAfter(SCRIPT.length).seats].sort((a, b) => b.score - a.score);
const nameOf = (seat: number) => (seat === PLAYER_SEAT ? "you" : SEAT_NAMES[seat]);
const [first, second, third] = finalSeats;

/** Shown in the game-over dialog. Scores come from the replay, not typed in. */
export const CLOSING =
  `So close! ${nameOf(first.seat)} wins with ${first.score}, then ${nameOf(second.seat)} with ${second.score}, ` +
  `and ${nameOf(third.seat)} with ${third.score}. Rostam's last tile carried him past you.`;
