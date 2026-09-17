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
 * One double-word square inset from each corner, plus the centre, on every
 * board regardless of layout -- the corner itself stays open (nothing to
 * stretch toward if the bonus square you're reaching for *is* the edge),
 * and inset by one rather than sitting on it is what makes reaching a
 * corner pay for building all the way out, not just for starting near one.
 * The centre is a bonus square in its own right too: it already has to be
 * the opening play, so doubling it rewards the word that covers it rather
 * than just the square arithmetic of landing there.
 *
 * A board would need to be at least 4x4 for the corner squares not to
 * collide with each other or the centre; every real layout is 15x15, so
 * this is more a documented assumption than a runtime concern.
 */
function bonusSquaresFor(size: number): ReadonlySet<string> {
  const near = 1;
  const far = size - 2;
  const middle = (size - 1) / 2;
  return new Set([
    `${near},${near}`,
    `${near},${far}`,
    `${far},${near}`,
    `${far},${far}`,
    `${middle},${middle}`,
  ]);
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
  return {
    name: layout.name,
    size,
    blocked,
    centre: { x: middle, y: middle },
    bonusSquares: bonusSquaresFor(size),
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
