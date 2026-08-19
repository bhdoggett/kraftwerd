import { useEffect, useMemo, useRef } from "react";
import { layoutByName, shapeOf } from "../../shared/boards";
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
  /** Which hand-drawn layout this game is played on. */
  layout: string;
  tiles: readonly BoardTile[];
  pending: readonly Placement[];
  canPlace: boolean;
  /** Square holding a blank that has not been told its letter yet. */
  awaitingBlankAt?: { x: number; y: number } | null;
  /** Squares in a word that checks out, and in one that does not. */
  goodCells?: ReadonlySet<string>;
  badCells?: ReadonlySet<string>;
  onPlace: (x: number, y: number) => void;
  onPickUp: (x: number, y: number) => void;
  /** Begin dragging a tile staged this turn to another square. */
  onGrabStaged?: (x: number, y: number, event: React.PointerEvent) => void;
}

const key = (x: number, y: number) => `${x},${y}`;

/**
 * The whole board, drawn like a crossword grid.
 *
 * No longer cropped to the played area: blocked squares are part of the puzzle
 * and can only be planned around if they can be seen, and a finite board's
 * edges matter well before you reach them.
 */
export function Board({
  boardSize,
  layout,
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
  const shape = useMemo(() => shapeOf(layoutByName(layout)), [layout]);

  /**
   * Dragging empty board pans it. Only for a mouse: touch already scrolls the
   * container natively, and hijacking that would fight the browser.
   *
   * A drag that moves past a few pixels also swallows the click that follows,
   * so panning away from a square does not drop a tile on it.
   */
  const viewport = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const panned = useRef(false);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const start = pan.current;
      const el = viewport.current;
      if (start === null || el === null) return;

      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) panned.current = true;

      el.scrollLeft = start.left - dx;
      el.scrollTop = start.top - dy;
    };

    const onUp = () => {
      pan.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

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

  const cells: React.ReactNode[] = [];

  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const k = key(x, y);
      const blocked = shape.blocked.has(k);
      const tile = committed.get(k);
      const stage = staged.get(k);
      const isCentre = x === shape.centre.x && y === shape.centre.y;
      const awaiting = awaitingBlankAt?.x === x && awaitingBlankAt?.y === y;
      const empty = !blocked && tile === undefined && stage === undefined;

      const classes = [styles.cell];
      if (blocked) classes.push(styles.blocked);
      if (tile) classes.push(styles.tile);
      if (tile?.isBlank) classes.push(styles.blank);
      if (stage) classes.push(styles.pending, styles.tile);
      if (stage?.isBlank) classes.push(styles.blank);
      if (goodCells?.has(k)) classes.push(styles.inWord);
      if (badCells?.has(k)) classes.push(styles.inBadWord);
      if (awaiting) classes.push(styles.tile, styles.blank, styles.awaiting);
      if (empty && !awaiting) {
        classes.push(styles.open);
        if (isCentre) classes.push(styles.centre);
        if (canPlace) classes.push(styles.playable, styles.armed);
      }

      cells.push(
        <button
          key={k}
          type="button"
          className={classes.join(" ")}
          data-cell={blocked || tile !== undefined ? undefined : k}
          data-staged={stage === undefined ? undefined : ""}
          aria-disabled={blocked || tile !== undefined || (!stage && !canPlace)}
          aria-label={
            blocked
              ? `blocked square, column ${x + 1}, row ${y + 1}`
              : tile || stage
                ? `${(tile ?? stage)!.letter} at column ${x + 1}, row ${y + 1}`
                : `open square, column ${x + 1}, row ${y + 1}`
          }
          onPointerDown={(e) => {
            if (stage && onGrabStaged) onGrabStaged(x, y, e);
          }}
          onClick={() => {
            // Swallowed if this click ended a pan rather than picking a square.
            if (panned.current) return;
            if (blocked || tile) return;
            if (stage) onPickUp(x, y);
            else if (canPlace) onPlace(x, y);
          }}
        >
          <span className={styles.glyph}>{(tile ?? stage)?.letter ?? ""}</span>
        </button>,
      );
    }
  }

  return (
    <div
      ref={viewport}
      className={styles.viewport}
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse") return;
        // A staged tile is dragged, not panned from.
        if ((e.target as HTMLElement).closest("[data-staged]") !== null) return;

        panned.current = false;
        const el = viewport.current;
        if (el === null) return;
        pan.current = {
          x: e.clientX,
          y: e.clientY,
          left: el.scrollLeft,
          top: el.scrollTop,
        };
      }}
    >
      <div
        className={styles.grid}
        style={{ gridTemplateColumns: `repeat(${boardSize}, var(--cell-size))` }}
      >
        {cells}
      </div>
    </div>
  );
}
