export interface Tile {
  letter: string;
  isBlank: boolean;
}

export interface Coord {
  x: number;
  y: number;
}

/** Sparse board keyed by `cellKey(x, y)`. */
export type Board = ReadonlyMap<string, Tile>;

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export interface TileSpec extends Coord {
  letter: string;
  isBlank?: boolean;
}

export function makeBoard(tiles: readonly TileSpec[]): Board {
  const board = new Map<string, Tile>();
  for (const t of tiles) {
    board.set(cellKey(t.x, t.y), {
      letter: t.letter,
      isBlank: t.isBlank ?? false,
    });
  }
  return board;
}
