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
  /** A line in hint markup (see `plain`). */
  text: string;
  /** Where it sits, when the usual (above) would cover something. */
  side?: "above" | "below" | "left" | "right";
}

/**
 * Hint markup: `**word**` is bold, and `[x2]`, `[x3]`, `[x4]` are the
 * board's own multiplier marks. This is the same line as plain text, as a
 * screen reader hears it: the marks read as ×2, ×3, ×4.
 */
export function plain(text: string): string {
  return text.replace(/\*\*/g, "").replace(/\[x(\d)\]/g, "×$1");
}

/** The first screen's one line. */
export const INTRO = "Learn by playing a real game! Drag each tile onto its **glowing ghost**, then press **Play**.";

/** The first screen, for a player who left partway: where they were. */
export const welcomeBack = (move: number, of: number) =>
  `Welcome back! Pick up at **your move ${move} of ${of}**, or start over.`;

/**
 * Pointed at the rack's blank on the player's first turn, once a couple of
 * tiles are down and while the blank still waits to be laid.
 */
export const BLANK_HINT = "This white tile is a **blank**: any letter you like. You get **3 for the whole game**.";

/**
 * The first time another player stacks, their replay stops on it until the
 * player has read this: Rostam's K on the player's A, turn 3.
 */
export const REPLAY_NOTE: { turn: number } & Callout = {
  turn: 2,
  cell: "7,9",
  // Below: above it would cover PICK, the word it is about.
  side: "below",
  text: "Rostam **stacked** his K on your A: PICA → PICK. A spot holds **2 tiles at most**.",
};

/**
 * On the player's first turn, once every tile is on its ghost and before
 * Play: what the play panel is for. `total` is what the move will score.
 */
export const scoreHint = (total: number) =>
  `This panel adds up your move: words, bonuses and the total, **${total}**. Then press **Play**.`;

/** After the player's third move: the basics are covered, so the rest is optional. */
export const OFFER = {
  turn: 7,
  text: "You've got the basics! **Keep playing**, or skip straight to the final scores.",
};

/** What the closing dialog lists as learned. */
export const LEARNED: readonly string[] = [
  "Laying tiles to make words, across and down",
  "Closing a 3×3 for +33",
  "Multipliers: ×2, ×3, ×4, each paying once",
  "Blanks: 3 a game, any letter",
  "Stacking, 2 tiles a spot at most",
  "Long words: a flat +5",
  "Going out when your tiles run out",
];

/** Now and then an opponent says something on their turn card. */
export const QUIPS: Readonly<Record<number, string>> = {
  2: "Sorry, I needed that spot!",
  3: "Nice square. This one's mine.",
  9: "Watch this.",
  16: "One tile is all I need.",
};

export const CALLOUTS: readonly (readonly Callout[])[] = [
  // 1. Isolde opens: her play is replayed the way a game replays it.
  [],
  // 2. You: your first 3×3 (the blank is pointed out before the move: BLANK_HINT)
  [{ cell: "8,9", text: "You finished a **3×3**: **+33**! Whoever lays the **last tile** of a 3×3 takes it.", side: "below" }],
  // 3. Rostam
  [],
  // 4. Isolde
  [],
  // 5. You: one ×4 multiplies two words; a long word
  [
    { cell: "13,13", text: "This [x4] multiplies every word through it: **GEM** and **BIOME** both." },
    { cell: "13,10", text: "BIOME has 5+ letters: a **flat +5**. The [x4] doesn't touch that part." },
  ],
  // 6. Rostam
  [],
  // 7. Isolde
  [],
  // 8. You: a multiplier only pays once
  [{ cell: "7,3", text: "LACEY scores every letter again, but the [x3] under L already paid: it **pays once**." }],
  // 9. Rostam
  [],
  // 10. Isolde
  [],
  // 11. You: stacking; tiles in three separate places
  [
    { cell: "1,4", text: "Your **stacks** turn Rostam's DRILL into **DRAGONS**!" },
    { cell: "13,14", text: "Three separate places this time: fine, as long as each group **touches** the board." },
  ],
  // 12. Rostam
  [],
  // 13. Isolde goes out, which changes whose turn comes next.
  [{ cell: "2,8", text: "Isolde played her last tile, so she's **out**. She'll be **skipped** from now on." }],
  // 14. You: W on a ×3; nothing left to draw
  [
    { cell: "11,3", text: "Your W sits on a [x3], and **WIFE** and **AW** run through it: both tripled.", side: "left" },
    { cell: "12,4", text: "The **bag is empty**: your rack won't refill. Play what you have!" },
  ],
  // 15. Rostam
  [],
  // 16. You go out
  [{ cell: "7,12", text: "Your hand is empty, so you're **out** too. Nice work!" }],
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
