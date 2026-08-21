import { useEffect, useMemo, useRef, useState } from "react";
import { boardShapeNamed } from "../../shared/boards";
import type { Placement } from "../../shared/engine/score";
import styles from "./Board.module.css";

interface BoardTile {
  x: number;
  y: number;
  letter: string;
  isBlank: boolean;
  /** Who put it there, so the board can light it in their colour. */
  placedBy: string;
}

interface BoardProps {
  boardSize: number;
  /** Which hand-drawn layout this game is played on. */
  layout: string;
  tiles: readonly BoardTile[];
  pending: readonly Placement[];
  /** Seat number per player id, which is what picks a tile's colour. */
  seatOf: ReadonlyMap<string, number>;
  /** The viewer's seat, so tiles they are still holding match their own. */
  yourSeat: number | null;
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
  seatOf,
  yourSeat,
  canPlace,
  awaitingBlankAt,
  goodCells,
  badCells,
  onPlace,
  onPickUp,
  onGrabStaged,
}: BoardProps) {
  // Resolved by name rather than looked up: an unknown name means an open
  // board, where layoutByName would fall back to the first drawn layout and
  // paint blocked squares onto a board that has none.
  const shape = useMemo(
    () => boardShapeNamed(layout, boardSize),
    [layout, boardSize],
  );

  /**
   * One pointer drags the board, two pinch it.
   *
   * Native scrolling is off here (touch-action: none) so that two fingers zoom
   * the board rather than the page — which means a single finger has to pan
   * explicitly rather than being left to the browser.
   *
   * A drag that moves past a few pixels swallows the click that follows, so
   * panning away from a square does not drop a tile on it.
   */
  const viewport = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const panned = useRef(false);

  /** Zoom factor applied to the cell size, not to the page. */
  const [zoom, setZoom] = useState(1);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  // Zoom is for looking closer. The board already fits at its base size, so
  // shrinking it only costs legibility -- the floor barely goes below 1.
  const clamp = (value: number) => Math.min(2.5, Math.max(0.95, value));

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const start = pan.current;
      const el = viewport.current;
      if (start === null || el === null) return;
      if (pointers.current.size > 1) return; // pinching, not panning

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

  /**
   * Wheel-zoom, bound natively so it can be non-passive.
   *
   * A trackpad pinch arrives as a wheel event with ctrlKey set, and the
   * browser would zoom the whole page unless the event is cancelled. Zooming
   * the board alone is what is wanted, so it is cancelled and the factor
   * applied here instead. A plain wheel still scrolls.
   */
  useEffect(() => {
    const el = viewport.current;
    if (el === null) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((current) => clamp(current * (1 - e.deltaY * 0.01)));
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** Two fingers on the board: pinch to zoom the board, not the page. */
  useEffect(() => {
    const track = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const [a, b] = [...pointers.current.values()];
      if (a === undefined || b === undefined) return;

      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current === null) {
        pinch.current = { distance, zoom };
        return;
      }
      // Two fingers means zooming, never panning.
      pan.current = null;
      setZoom(clamp(pinch.current.zoom * (distance / pinch.current.distance)));
    };

    const drop = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
    };

    window.addEventListener("pointermove", track);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    return () => {
      window.removeEventListener("pointermove", track);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
    };
  }, [zoom]);

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

      // Whose colour this square is lit in. A tile being staged is not on the
      // board yet, but it is the viewer's, so it takes their colour early.
      const seat = tile ? seatOf.get(tile.placedBy) : stage ? (yourSeat ?? undefined) : undefined;

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
          data-seat={seat === undefined ? undefined : seat % 4}
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
      style={{ "--cell-scale": zoom } as React.CSSProperties}
      onPointerDown={(e) => {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        // A staged tile is dragged, not panned from.
        if ((e.target as HTMLElement).closest("[data-staged]") !== null) return;
        if (pointers.current.size > 1) return;

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
      data-seat={yourSeat === null ? undefined : yourSeat % 4}
        style={{ gridTemplateColumns: `repeat(${boardSize}, var(--cell-size))` }}
      >
        {cells}
      </div>
    </div>
  );
}
