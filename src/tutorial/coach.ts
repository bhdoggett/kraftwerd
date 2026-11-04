/**
 * What the coach card says on each turn of the tutorial (one entry per SCRIPT
 * turn). The story only: the card prints the computed breakdown (each word's
 * points and multiplier, the 3×3 bonus, the long-word bonus, the total) right
 * under this text, so the text never restates those numbers.
 *
 * Every claim here was checked against factsFor(i) and tilesAfter(i): which
 * word crossed which multiplier, whose tile was stacked on, who laid most of
 * a closed 3×3. Change SCRIPT and this text has to be re-checked by hand.
 */

import { standingsAfter } from "./model";
import { PLAYER_SEAT, SCRIPT, SEAT_NAMES } from "./script";

export interface CoachText {
  /** Shown on the player's own turns, before they move: what to do. */
  before?: string;
  /** Shown once the move is on the board: what happened and why. */
  after: string;
}

export const COACH: readonly CoachText[] = [
  // 1. Isolde: UP CUT PIC TA
  {
    after:
      "Isolde opens the game. The first word must cover the centre, a ×2 spot that doubles any word running over it: PIC crosses it, and TA crosses another ×2. Every line of two or more tiles must be a real word, both ways: across and down.",
  },
  // 2. You: ANA NITS PICA TUN STAB UN, closes a 3×3
  {
    before:
      "Your move. Drag each tile onto its faded ghost letter, then press Play. The ? is a blank: it can be any letter, and here it becomes an S. You get 3 a game, never refilled.",
    after:
      "You closed your first 3×3, even though Isolde laid most of it. A full 3×3 is worth 33, and whoever places the last tile takes it. Every word also scores all its letters, even the ones already on the board.",
  },
  // 3. Rostam: KNAVE HIP PICK EMO IN
  {
    after:
      "Rostam stacked a K on top of your A, turning PICA into PICK. A spot can hold 2 tiles at most, so it can change hands once and then it's settled. EMO covers a triangle, a ×3, and KNAVE is a long word: 5 letters or more earns +5.",
  },
  // 4. Isolde: closes a 3×3 over yours
  {
    after:
      "Isolde closed a 3×3 that overlaps yours, using your N and Rostam's K. Her tiles went down in more than one place. That's allowed, as long as each group of new tiles touches the tiles already there, so the board stays in one piece.",
  },
  // 5. You: MOB GEM BIOME, M on a ×4
  {
    before: "Head for the bottom-right corner: the spot one in from it is a ×4. Your blank becomes an O.",
    after:
      "Your M sits on a ×4, and both GEM and BIOME run through it, so both are multiplied. BIOME also earns the long-word bonus, which is never multiplied.",
  },
  // 6. Rostam: five stacks, PRIME, closes a 3×3 near the centre
  {
    after:
      "Rostam stacked three tiles on your BIOME to make PRIME. Changing letters in a long word doesn't earn the bonus again; only a new or longer word does. Near the centre, he filled the last gaps of a 3×3 and took it.",
  },
  // 7. Isolde: LACE on a ×3, CUBS to BUBS, CHUBS
  {
    after:
      "Isolde's L lands on a ×3, so LACE is tripled. She stacked a B on her own C, so CUBS became BUBS. A C added above HUBS made CHUBS, a new long word.",
  },
  // 8. You: DOGS on a ×4, LACEY
  {
    before: "There's another ×4 within reach, up in the top-left corner.",
    after:
      "DOGS hits the ×4. Your Y on the end of LACE makes LACEY: every letter scores again (the ×3 under the L was already used), and it's now long enough for the bonus.",
  },
  // 9. Rostam: PRY on a ×3, DRILL, EYE
  {
    after:
      "Rostam built PRY up from your Y, with the P on a ×3. He also hung DRILL down from your D, a long word.",
  },
  // 10. Isolde: REFORMED through a ×3 and a ×4
  {
    after:
      "A huge turn for Isolde. REFORMED crosses a ×3 and a ×4, and when one word covers two multipliers they multiply together: ×3 times ×4 is ×12. She spent her last two blanks on it.",
  },
  // 11. You: four stacks, DRAGONS, PRIMA, blank S on a ×3
  {
    before: "Time to stack. Four of your tiles go on top of tiles already down, and your last blank becomes an S.",
    after:
      "You stacked onto Rostam's DRILL and turned it into DRAGONS. Your blank landed on a ×3 that both OS and DRAGONS run through. Your A replaces the E at the end of PRIME, making PRIMA.",
  },
  // 12. Rostam: closes a 3×3 on the left, draws the last tiles
  {
    after:
      "Rostam closed a 3×3 on the left edge, and four of its tiles are yours. He also drew the last tiles from the bag. From here on nobody draws: everyone plays what's left in their hand.",
  },
  // 13. Isolde: last seven tiles, four stacks, goes out
  {
    after:
      "Isolde plays her last seven tiles. Two of her stacks sit on multipliers that were already used, and a multiplier only pays once. Her hand and the bag are both empty, so she is out.",
  },
  // 14. You: Isolde skipped; closes a 3×3, W on a ×3
  {
    before: "Isolde is out, so she's skipped from now on. Close a 3×3 up in the top-right corner.",
    after:
      "The 3×3 is yours, though Isolde laid most of it. Your W lands on a ×3, and both WIFE and AW run through it.",
  },
  // 15. Rostam: PRY to PAY, DOGS to DIGS
  {
    after:
      "Rostam is nearly done. He stacked an A on his own R, turning PRY into PAY, and an I on your O, turning DOGS into DIGS. He still holds a blank, so he isn't out yet.",
  },
  // 16. You: OS OD, goes out
  {
    before: "Your last two tiles. Play them and you're out.",
    after: "OD crosses a ×3. Your hand is empty, so you're out too. Only Rostam has a tile left.",
  },
  // 17. Rostam: one blank closes a 3×3
  {
    after:
      "Rostam's last tile is his blank, and it closes a 3×3 that overlaps the one you closed. One tile takes the whole square. Everyone is out now, so the game is over.",
  },
];

const finalSeats = [...standingsAfter(SCRIPT.length).seats].sort((a, b) => b.score - a.score);
const nameOf = (seat: number) => (seat === PLAYER_SEAT ? "you" : SEAT_NAMES[seat]);
const [first, second, third] = finalSeats;

/** Shown with the game-over screen. Scores come from the replay, not typed in. */
export const CLOSING =
  `So close! ${nameOf(first.seat)} wins with ${first.score}, then ${nameOf(second.seat)} with ${second.score}, ` +
  `and ${nameOf(third.seat)} with ${third.score}. Rostam's last tile carried him past you.`;
