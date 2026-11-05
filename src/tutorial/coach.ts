/**
 * What the tutorial points out after a move (one entry per SCRIPT turn): a
 * line or two pinned to the board square it is about, only when the player's
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
  /** Where it sits, when the usual (above, or below for a second line) would cover something. */
  side?: "above" | "below" | "left" | "right";
}

/**
 * Pointed at the rack's blank on the player's first turn, while it pulses
 * with its ghost, until it is laid.
 */
export const BLANK_HINT = "This white tile is a blank: it can be any letter. You have 3 for the whole game, so use them whenever you like! Drop it on the white ghost.";

/**
 * The first time another player stacks, their replay stops on it until the
 * player has read this: Rostam's K on the player's A, turn 3.
 */
export const REPLAY_NOTE: { turn: number } & Callout = {
  turn: 2,
  cell: "7,9",
  // Below: above it would cover PICK, the word it is about.
  side: "below",
  text: "Rostam stacked his K right on top of your A, turning PICA into PICK. A spot can hold 2 tiles at most.",
};

/**
 * On the player's first turn, once every tile is on its ghost and before
 * Play: what the play panel is for. `total` is what the move will score.
 */
export const scoreHint = (total: number) =>
  `This panel adds up your move: each word's points, any multipliers and bonuses, and the total, ${total}. Press Play when you're ready!`;

/** The first screen's one line. */
export const INTRO = "Learn by playing a real game! On your turns, drag each tile onto its glowing ghost, then press Play.";

export const CALLOUTS: readonly (readonly Callout[])[] = [
  // 1. Isolde opens: her play is replayed the way a game replays it.
  [],
  // 2. You: your first 3×3 (the blank is pointed out before the move: BLANK_HINT)
  [
    { cell: "8,9", text: "You finished a 3×3, worth 33 points! Whoever lays the last tile of a 3×3 takes it.", side: "below" },
  ],
  // 3. Rostam
  [],
  // 4. Isolde
  [],
  // 5. You: one ×4 multiplies two words; a long word
  [
    { cell: "13,13", text: "This ×4 spot multiplies every word through it: GEM and BIOME both run through it." },
    { cell: "13,10", text: "BIOME has 5 or more letters, so it earns a flat +5 bonus. The ×4 doesn't multiply that part.", side: "above" },
  ],
  // 6. Rostam
  [],
  // 7. Isolde
  [],
  // 8. You: a multiplier only pays once
  [{ cell: "7,3", text: "LACEY scores every letter again, but the ×3 under the L already paid out: a multiplier pays once." }],
  // 9. Rostam
  [],
  // 10. Isolde
  [],
  // 11. You: stacking; tiles in three separate places
  [
    { cell: "1,4", text: "Your stacks turn Rostam's DRILL into DRAGONS!" },
    { cell: "13,14", text: "Your tiles went down in three separate places. That's fine, as long as each group touches tiles already on the board." },
  ],
  // 12. Rostam
  [],
  // 13. Isolde goes out, which changes whose turn comes next.
  [{ cell: "2,8", text: "Isolde has played her last tile, so she's out. She'll be skipped from now on." }],
  // 14. You: W on a ×3; nothing left to draw
  [
    { cell: "11,3", text: "Your W sits on a ×3, and both WIFE and AW run through it, so both are tripled.", side: "left" },
    { cell: "12,4", text: "The bag is empty now, so your rack won't refill. Play what you have left!" },
  ],
  // 15. Rostam
  [],
  // 16. You go out
  [{ cell: "7,12", text: "Your hand is empty, so you're out too. Nice work!" }],
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
