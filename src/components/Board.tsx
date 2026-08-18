import { useMemo } from "react";
import type { Placement } from "../../shared/engine/score";
import styles from "./Board.module.css";

export interface BoardTile {
  x: number;
  y: number;
  letter: string;
  isBlank: boolean;
  placedBy: string;
}

interface BoardProps {
  boardSize: number;
  tiles: readonly BoardTile[];
  pending: readonly Placement[];
  /** Seat index per user id, for the ownership stripe. */
  seatOf: (userId: string) => number;
  canPlace: boolean;
  onPlace: (x: number, y: number) => void;
  onPickUp: (x: number, y: number) => void;
}

/** Cells of empty board kept visible around the played area. */
const MARGIN = 3;
const MIN_SPAN = 12;

/**
 * The board is 40x40 but a game only ever places ~100 tiles, and connectivity
 * keeps them in one clump. Rendering all 1600 cells would be mostly empty
 * space to scroll through, so the view crops to the played area plus a margin.
 */
function windowFor(
  boardSize: number,
  tiles: readonly { x: number; y: number }[],
  pending: readonly { x: number; y: number }[],
) {
  const all = [...tiles, ...pending];
  if (all.length === 0) {
    const mid = Math.floor(boardSize / 2);
    const half = Math.floor(MIN_SPAN / 2);
    return { x0: mid - half, y0: mid - half, x1: mid + half, y1: mid + half };
  }

  const xs = all.map((t) => t.x);
  const ys = all.map((t) => t.y);
  let x0 = Math.min(...xs) - MARGIN;
  let y0 = Math.min(...ys) - MARGIN;
  let x1 = Math.max(...xs) + MARGIN;
  let y1 = Math.max(...ys) + MARGIN;

  // Keep the view from collapsing around a tiny opening play.
  const grow = (a: number, b: number) => {
    const short = MIN_SPAN - (b - a + 1);
    if (short <= 0) return [a, b] as const;
    const half = Math.ceil(short / 2);
    return [a - half, b + half] as const;
  };
  [x0, x1] = grow(x0, x1);
  [y0, y1] = grow(y0, y1);

  return {
    x0: Math.max(0, x0),
    y0: Math.max(0, y0),
    x1: Math.min(boardSize - 1, x1),
    y1: Math.min(boardSize - 1, y1),
  };
}

export function Board({
  boardSize,
  tiles,
  pending,
  seatOf,
  canPlace,
  onPlace,
  onPickUp,
}: BoardProps) {
  const view = useMemo(
    () => windowFor(boardSize, tiles, pending),
    [boardSize, tiles, pending],
  );

  const committed = useMemo(() => {
    const map = new Map<string, BoardTile>();
    for (const t of tiles) map.set(`${t.x},${t.y}`, t);
    return map;
  }, [tiles]);

  const staged = useMemo(() => {
    const map = new Map<string, Placement>();
    for (const p of pending) map.set(`${p.x},${p.y}`, p);
    return map;
  }, [pending]);

  const columns = view.x1 - view.x0 + 1;
  const rows: React.ReactNode[] = [];

  for (let y = view.y0; y <= view.y1; y++) {
    for (let x = view.x0; x <= view.x1; x++) {
      const key = `${x},${y}`;
      const tile = committed.get(key);
      const stage = staged.get(key);

      const classes = [styles.cell];
      if (tile) classes.push(styles.tile);
      if (tile?.isBlank) classes.push(styles.blank);
      if (stage) classes.push(styles.pending, styles.tile);
      if (stage?.isBlank) classes.push(styles.blank);
      if (!tile && !stage) {
        classes.push(styles.empty);
        if (canPlace) classes.push(styles.playable, styles.armed);
      }

      rows.push(
        <button
          key={key}
          type="button"
          className={classes.join(" ")}
          // `data-cell` is how a pointer drag resolves its drop target: on
          // release the layer hit-tests with elementFromPoint and reads this.
          data-cell={tile === undefined ? key : undefined}
          // Deliberately not `disabled`: a disabled control receives no
          // pointer events and is skipped by elementFromPoint, which would
          // make it invisible to the drag layer. The guard lives in onClick.
          aria-disabled={tile !== undefined || (!stage && !canPlace)}
          aria-label={
            tile || stage
              ? `${(tile ?? stage)!.letter} at column ${x + 1}, row ${y + 1}`
              : `empty square, column ${x + 1}, row ${y + 1}`
          }
          onClick={() => {
            if (tile) return;
            if (stage) onPickUp(x, y);
            else if (canPlace) onPlace(x, y);
          }}
        >
          {(tile ?? stage)?.letter ?? "·"}
          {tile && (
            <span
              className={styles.seat}
              style={{ background: `var(--seat-${seatOf(tile.placedBy) % 4})` }}
            />
          )}
        </button>,
      );
    }
  }

  return (
    <div className={styles.viewport}>
      <div
        className={styles.grid}
        style={{ gridTemplateColumns: `repeat(${columns}, var(--cell-size))` }}
      >
        {rows}
      </div>
    </div>
  );
}
