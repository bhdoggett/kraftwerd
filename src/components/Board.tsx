import { useMemo } from "react";
import type { Placement } from "../../shared/engine/score";
import styles from "./Board.module.css";

export interface BoardTile {
  x: number;
  y: number;
  letter: string;
  isBlank: boolean;
}

interface BoardProps {
  boardSize: number;
  tiles: readonly BoardTile[];
  pending: readonly Placement[];
  canPlace: boolean;
  onPlace: (x: number, y: number) => void;
  onPickUp: (x: number, y: number) => void;
  /** Square holding a blank that has not been told its letter yet. */
  awaitingBlankAt?: { x: number; y: number } | null;
  /** Squares in a word that checks out, and in one that does not. */
  goodCells?: ReadonlySet<string>;
  badCells?: ReadonlySet<string>;
  /** Begin dragging a tile staged this turn to another square. */
  onGrabStaged?: (x: number, y: number, event: React.PointerEvent) => void;
}

/**
 * Diagonals included deliberately. Connectivity (design.md §3) is orthogonal,
 * so a tile touching only at a corner is not yet legal — but it becomes legal
 * once the gap is filled, and a 2x2 is often easiest to sketch by dropping its
 * far corner first. Offering the square lets you build in whatever order suits
 * you; the validator still refuses to let you play a disconnected shape.
 */
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

const key = (x: number, y: number) => `${x},${y}`;

/**
 * The empty squares worth drawing: those touching an occupied square, corners
 * included.
 *
 * The board is far larger than any game uses, and connectivity (design.md §3)
 * means a tile may only be placed against the existing mass — so the squares
 * next to it are exactly the legal moves. Drawing the full grid would be a
 * field of identical cells where almost none can be played. An empty board
 * offers a single square at the centre, and the playable edge grows outward
 * from there.
 *
 * This costs no legal play: any connected shape can be built by adding
 * squares one at a time, so every placement stays reachable as the frontier
 * expands with each staged tile.
 */
function frontierOf(
  boardSize: number,
  occupied: ReadonlySet<string>,
  coords: readonly { x: number; y: number }[],
): Set<string> {
  const frontier = new Set<string>();

  if (coords.length === 0) {
    const mid = Math.floor(boardSize / 2);
    frontier.add(key(mid, mid));
    return frontier;
  }

  for (const { x, y } of coords) {
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= boardSize || ny >= boardSize) continue;
      if (occupied.has(key(nx, ny))) continue;
      frontier.add(key(nx, ny));
    }
  }

  return frontier;
}

export function Board({
  boardSize,
  tiles,
  pending,
  canPlace,
  awaitingBlankAt,
  goodCells,
  badCells,
  onPlace,
  onPickUp,
  onGrabStaged,
}: BoardProps) {
  const committed = useMemo(() => {
    const map = new Map<string, BoardTile>();
    for (const t of tiles) map.set(key(t.x, t.y), t);
    return map;
  }, [tiles]);

  const staged = useMemo(() => {
    const map = new Map<string, Placement>();
    for (const p of pending) map.set(key(p.x, p.y), p);
    return map;
  }, [pending]);

  const { cells, x0, y0, columns, rows, frontier } = useMemo(() => {
    const occupiedKeys = new Set([...committed.keys(), ...staged.keys()]);
    const coords = [
      ...[...committed.values()].map(({ x, y }) => ({ x, y })),
      ...[...staged.values()].map(({ x, y }) => ({ x, y })),
    ];
    const open = frontierOf(boardSize, occupiedKeys, coords);

    const all = [
      ...coords,
      ...[...open].map((k) => {
        const [x, y] = k.split(",").map(Number);
        return { x: x!, y: y! };
      }),
    ];

    const xs = all.map((c) => c.x);
    const ys = all.map((c) => c.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);

    return {
      cells: all,
      frontier: open,
      x0: minX,
      y0: minY,
      columns: Math.max(...xs) - minX + 1,
      rows: Math.max(...ys) - minY + 1,
    };
  }, [boardSize, committed, staged]);

  return (
    <div className={styles.viewport}>
      <div
        className={styles.grid}
        style={{
          gridTemplateColumns: `repeat(${columns}, var(--cell-size))`,
          gridTemplateRows: `repeat(${rows}, var(--cell-size))`,
        }}
      >
        {cells.map(({ x, y }) => {
          const k = key(x, y);
          const tile = committed.get(k);
          const stage = staged.get(k);
          const isOpen = frontier.has(k);
          const awaiting =
            awaitingBlankAt?.x === x && awaitingBlankAt?.y === y;

          const classes = [styles.cell];
          if (tile) classes.push(styles.tile);
          if (tile?.isBlank) classes.push(styles.blank);
          if (stage) classes.push(styles.pending, styles.tile);
          if (stage?.isBlank) classes.push(styles.blank);
          if (goodCells?.has(k)) classes.push(styles.inWord);
          if (badCells?.has(k)) classes.push(styles.inBadWord);
          if (awaiting) classes.push(styles.tile, styles.blank, styles.awaiting);
          if (isOpen && !awaiting) {
            classes.push(styles.open);
            if (canPlace) classes.push(styles.playable, styles.armed);
          }

          return (
            <button
              key={k}
              type="button"
              className={classes.join(" ")}
              // Every cell is positioned explicitly, so only the played area
              // and its edge exist in the DOM -- not the squares between them.
              style={{ gridColumn: x - x0 + 1, gridRow: y - y0 + 1 }}
              data-cell={tile === undefined ? k : undefined}
              aria-disabled={tile !== undefined || (!stage && !canPlace)}
              aria-label={
                tile || stage
                  ? `${(tile ?? stage)!.letter} at column ${x + 1}, row ${y + 1}`
                  : `open square, column ${x + 1}, row ${y + 1}`
              }
              onPointerDown={(e) => {
                if (stage && onGrabStaged) onGrabStaged(x, y, e);
              }}
              onClick={() => {
                if (tile) return;
                if (stage) onPickUp(x, y);
                else if (canPlace) onPlace(x, y);
              }}
            >
              <span className={styles.glyph}>{(tile ?? stage)?.letter ?? ""}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
