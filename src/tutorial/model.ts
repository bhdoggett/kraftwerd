import { boardShapeNamed } from "../../shared/boards";
import { BLANKS_PER_GAME } from "../../shared/config";
import { cellKey, makeBoard } from "../../shared/engine/board";
import { applyPlacements } from "../../shared/engine/legality";
import { scoreTurn, type Placement, type TurnScore } from "../../shared/engine/score";
import { newSquareBlocks } from "../../shared/engine/squares";
import { BAG_SIZE, BOARD_SIZE, LAYOUT, RACK_SIZE, SCRIPT } from "./script";

export interface TutorialTile {
  x: number;
  y: number;
  letter: string;
  isBlank: boolean;
  /** `seat${n}` of whoever put the top tile there. */
  placedBy: string;
  /** How many tiles have ever landed on this square. */
  stacked: number;
}

export interface SeatStanding {
  seat: number;
  score: number;
  tilesInHand: number;
  blanks: number;
  out: boolean;
}

export interface TurnFacts {
  score: TurnScore;
  /** `cellKey` of every cell in each new 3x3. */
  newSquares: readonly string[];
}

export const seatId = (seat: number) => `seat${seat}`;

const bonusSquares = boardShapeNamed(LAYOUT, BOARD_SIZE).bonusSquares;

/** The board after the first `turns` turns. */
export function tilesAfter(turns: number): TutorialTile[] {
  const board = new Map<string, TutorialTile>();
  for (const turn of SCRIPT.slice(0, Math.max(0, turns))) {
    for (const p of turn.placements) {
      const key = cellKey(p.x, p.y);
      board.set(key, {
        x: p.x,
        y: p.y,
        letter: p.letter,
        isBlank: p.isBlank,
        placedBy: seatId(turn.seat),
        stacked: (board.get(key)?.stacked ?? 0) + 1,
      });
    }
  }
  return [...board.values()];
}

export function standingsAfter(turns: number): { seats: SeatStanding[]; bagLeft: number } {
  const seats = [0, 1, 2].map((seat) => ({ seat, score: 0, tilesInHand: RACK_SIZE, blanks: BLANKS_PER_GAME, out: false }));
  let bagLeft = BAG_SIZE - 3 * RACK_SIZE;

  for (const turn of SCRIPT.slice(0, Math.max(0, turns))) {
    const s = seats[turn.seat];
    const blanks = turn.placements.filter((p) => p.isBlank).length;
    s.score += turn.score;
    s.blanks -= blanks;
    s.tilesInHand -= turn.placements.length - blanks;
    const drawn = Math.min(bagLeft, RACK_SIZE - s.tilesInHand);
    s.tilesInHand += drawn;
    bagLeft -= drawn;
  }
  for (const s of seats) s.out = s.tilesInHand === 0 && s.blanks === 0 && bagLeft === 0;

  return { seats, bagLeft };
}

/** scoreTurn for SCRIPT[turn], on the board before it. */
export function factsFor(turn: number): TurnFacts {
  const placements = SCRIPT[turn].placements;
  const before = makeBoard(tilesAfter(turn));
  const after = applyPlacements(before, placements);
  const score = scoreTurn(after, placements, { before, bonusSquares });
  const newSquares: string[] = [];
  for (const b of newSquareBlocks(before, after, placements)) {
    for (let y = b.y; y < b.y + b.k; y++) {
      for (let x = b.x; x < b.x + b.k; x++) newSquares.push(cellKey(x, y));
    }
  }
  return { score, newSquares };
}

export type Feedback =
  | { kind: "ready" }
  | { kind: "missing"; count: number }
  | { kind: "offGhost"; letter: string; x: number; y: number; target: { x: number; y: number } }
  | { kind: "wrongLetter"; x: number; y: number; placed: string; wanted: string };

/** How the learner's staged tiles stand against the recorded turn's ghosts. */
export function checkPlacement(turn: number, staged: readonly Placement[]): Feedback {
  const ghosts = SCRIPT[turn].placements;
  const ghostAt = (x: number, y: number) => ghosts.find((g) => g.x === x && g.y === y);
  const unfilled = ghosts.filter((g) => !staged.some((s) => s.x === g.x && s.y === g.y));

  // By letter alone: a blank standing for O scores the same as a real O, so
  // either may sit on either O ghost.
  const matches = (s: Placement, g: Placement) => s.letter === g.letter;

  for (const s of staged) {
    if (ghostAt(s.x, s.y) !== undefined) continue;
    const exact = unfilled.find((g) => matches(s, g));
    const nearest = [...(unfilled.length > 0 ? unfilled : ghosts)].sort(
      (a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y),
    )[0];
    const target = exact ?? nearest;
    return { kind: "offGhost", letter: s.letter, x: s.x, y: s.y, target: { x: target.x, y: target.y } };
  }

  for (const s of staged) {
    const g = ghostAt(s.x, s.y);
    if (g !== undefined && !matches(s, g)) {
      return { kind: "wrongLetter", x: s.x, y: s.y, placed: s.letter, wanted: g.letter };
    }
  }

  if (staged.length < ghosts.length) return { kind: "missing", count: ghosts.length - staged.length };
  return { kind: "ready" };
}
