import type { Coord } from "./engine/board.js";

/**
 * Hand-drawn boards, in the crossword tradition: 15x15, blocked squares in
 * bars of two and three rather than lone cells, arranged with 180-degree
 * rotational symmetry, and an open centre that the opening word must cover.
 *
 * Written as pictures rather than coordinates so a new one can be drawn by
 * editing the art. `#` is blocked, `.` is open. `boards.test.ts` checks every
 * layout is square, symmetric, centred on an open square, and leaves all its
 * open squares reachable from one another.
 */
interface BoardLayout {
  name: string;
  rows: readonly string[];
}

export const BOARD_LAYOUTS: readonly BoardLayout[] = [
  {
    name: "Bars",
    rows: [
      "###.........###",
      "...............",
      "......###......",
      "##...........##",
      "...............",
      "....##...##....",
      "...............",
      "###.........###",
      "...............",
      "....##...##....",
      "...............",
      "##...........##",
      "......###......",
      "...............",
      "###.........###",
    ],
  },
  {
    name: "Steps",
    rows: [
      "...............",
      "..###.....###..",
      "...............",
      "....##...##....",
      "...............",
      "##....###....##",
      "...............",
      "...##.....##...",
      "...............",
      "##....###....##",
      "...............",
      "....##...##....",
      "...............",
      "..###.....###..",
      "...............",
    ],
  },
  {
    name: "Frame",
    rows: [
      "...............",
      "...###...###...",
      "...............",
      "##...........##",
      "...............",
      "...............",
      ".....#...#.....",
      "...............",
      ".....#...#.....",
      "...............",
      "...............",
      "##...........##",
      "...............",
      "...###...###...",
      "...............",
    ],
  },
];

/** A board's size, blocked squares and centre, ready for the rules to use. */
export interface BoardShape {
  name: string;
  size: number;
  blocked: ReadonlySet<string>;
  centre: Coord;
  /** Double-word squares, one in from each corner -- see bonusSquaresFor. */
  bonusSquares: ReadonlySet<string>;
}

/**
 * Double-word squares on the four diagonals running from each corner toward
 * the centre, one in from the corner and then every other square in from
 * there -- stopping short of the centre itself, which stays a plain (if
 * mandatory) start rather than a guaranteed bonus for whoever happens to go
 * first. Skipping a square each time is what makes the run a series of
 * waypoints to reach for rather than a solid line: a word can cross two on
 * its way past, since each fresh one it crosses doubles independently (see
 * ScoreOptions.bonusSquares in shared/engine/score.ts) -- a real, if
 * telegraphed and snipeable, jackpot.
 *
 * A board would need to be at least 6x6 for these not to collide with each
 * other or the centre; every real layout is 15x15, so this is more a
 * documented assumption than a runtime concern.
 */
function bonusSquaresFor(size: number): ReadonlySet<string> {
  const middle = (size - 1) / 2;
  const squares = new Set<string>();
  for (let k = 2; k <= middle - 1; k += 2) {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        squares.add(`${middle + sx * k},${middle + sy * k}`);
      }
    }
  }
  return squares;
}

export function shapeOf(layout: BoardLayout): BoardShape {
  const size = layout.rows.length;
  const blocked = new Set<string>();

  for (const [y, row] of layout.rows.entries()) {
    for (const [x, cell] of [...row].entries()) {
      if (cell === "#") blocked.add(`${x},${y}`);
    }
  }

  const middle = (size - 1) / 2;
  // The diagonal waypoints are placed by pure geometry, but a hand-drawn
  // layout's own blocked bars can happen to land on the same cell (Bars
  // does, at all four of its innermost waypoints) -- a blocked square
  // can't score a word at all, let alone a doubled one, so it just goes
  // without a bonus there rather than the two disagreeing.
  const bonusSquares = new Set(
    [...bonusSquaresFor(size)].filter((key) => !blocked.has(key)),
  );
  return {
    name: layout.name,
    size,
    blocked,
    centre: { x: middle, y: middle },
    bonusSquares,
  };
}



/** The name new games use: a board with nothing blocked out. */
export const OPEN_BOARD = "Open";

/**
 * The shape a game is played on.
 *
 * An unknown name — including the open board — gives a board with no blocked
 * squares. The drawn layouts stay available to anything that asks for one by
 * name, so games already dealt one keep their board.
 */
export function boardShapeNamed(name: string | undefined, size: number): BoardShape {
  const drawn = BOARD_LAYOUTS.find((l) => l.name === name);
  if (drawn !== undefined) return shapeOf(drawn);

  const middle = (size - 1) / 2;
  return {
    name: OPEN_BOARD,
    size,
    blocked: new Set<string>(),
    centre: { x: middle, y: middle },
    bonusSquares: bonusSquaresFor(size),
  };
}
