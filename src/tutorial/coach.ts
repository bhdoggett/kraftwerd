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

import { standingsAfter, tilesAfter } from "./model";
import { PLAYER_SEAT, SCRIPT, SEAT_NAMES } from "./script";

export interface Callout {
  /**
   * The square it points at, as `x,y`; null for a line about the game rather
   * than a square (who is out, an empty bag), which sits centred over the
   * board instead of pointing at a tile it has nothing to say about.
   */
  cell: string | null;
  /**
   * Words it talks about that run through `cell`, every tile of each lit on
   * the board (see `calloutCells`) so the whole word reads as the subject,
   * not just the square the bubble points at.
   */
  words?: readonly string[];
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
  words: ["PICK"],
  // Below: above it would cover PICK, the word it is about.
  side: "below",
  text: "Rostam **stacked** his K on your A: PICA → PICK. A spot holds **2 tiles at most**.",
};

/**
 * The first move to cross two multipliers in one word, held like the stack
 * note: Isolde's REFORMED, turn 10, through the [x4] at 13,1 and the [x3] at
 * 13,7, for 8 × 12 = 96.
 */
export const MULTIPLIER_NOTE: { turn: number } & Callout = {
  turn: 9,
  cell: "13,4",
  words: ["REFORMED"],
  // Left: the word runs down the board's right-hand edge.
  side: "left",
  text: "Isolde's **REFORMED** runs through a [x4] **and** a [x3]: they multiply each other, **×12**, for **96**!",
};

/** The other players' moves the replay stops on until their note is read. */
export const REPLAY_NOTES: readonly ({ turn: number } & Callout)[] = [REPLAY_NOTE, MULTIPLIER_NOTE];

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
    { cell: "13,13", words: ["GEM", "BIOME"], text: "This [x4] multiplies every word through it: **GEM** and **BIOME** both." },
    { cell: "13,10", words: ["BIOME"], text: "**BIOME** has 5+ letters, so you get a **5 point bonus**, but the [x4] doesn't multiply the bonus." },
  ],
  // 6. Rostam
  [],
  // 7. Isolde
  [],
  // 8. You: a longer word scores every letter again, plus the +5
  [{ cell: "7,3", words: ["LACEY"], text: "**LACEY** scores every letter again, but now with the **5-point bonus** for 5+ letter words." }],
  // 9. Rostam
  [],
  // 10. Isolde
  [],
  // 11. You: stacking
  [
    {
      cell: "1,4",
      words: ["DRAGONS"],
      text: "Your **stacks** turned Rostam's DRILL into **DRAGONS**!",
      // Right: DRAGONS runs down the left edge, and above would cover it.
      side: "right",
    },
  ],
  // 12. Rostam
  [],
  // 13. Isolde goes out, which changes whose turn comes next.
  [{ cell: null, text: "Isolde played her last tile, so she's **out**. She'll be **skipped** from now on." }],
  // 14. You: W on a ×3; nothing left to draw
  [
    { cell: "11,3", words: ["WIFE", "AW"], text: "Your W sits on a [x3], and **WIFE** and **AW** run through it: both tripled.", side: "left" },
    { cell: null, text: "The **bag is empty**: your rack won't refill. Play what you have!" },
  ],
  // 15. Rostam
  [],
  // 16. You go out
  [{ cell: null, text: "Your hand is empty, so you're **out** too. Nice work!" }],
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

/**
 * The squares a callout lights once turn `turn`'s move is down: the one it
 * points at, and every tile of each word it names, found by reading across
 * and then down from that square.
 */
export function calloutCells(turn: number, callout: Callout): string[] {
  if (callout.cell === null) return [];
  const letters = new Map(tilesAfter(turn + 1).map((t) => [`${t.x},${t.y}`, t.letter]));
  const [cx, cy] = callout.cell.split(",").map(Number);
  const cells = new Set([callout.cell]);
  for (const word of callout.words ?? []) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const at = (i: number) => `${cx + dx * i},${cy + dy * i}`;
      let from = 0;
      while (letters.has(at(from - 1))) from--;
      let to = 0;
      while (letters.has(at(to + 1))) to++;
      const run = Array.from({ length: to - from + 1 }, (_, i) => at(from + i));
      if (run.map((k) => letters.get(k)).join("") !== word) continue;
      for (const k of run) cells.add(k);
      break;
    }
  }
  return [...cells];
}
