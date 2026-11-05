import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import styles from "./Tutorial.module.css";

export type Side = "above" | "below" | "left" | "right";

interface BubbleProps {
  /** The square pointed at, as `x,y`; null for a bubble centred over the board. */
  cell: string | null;
  /**
   * Something other than a board square to point at, found inside the same
   * parent: the rack's blank, say. It may then spill out of its parent
   * upward, over the board.
   */
  anchor?: string;
  text: string;
  /** Which side of the square to try first; another is used if this one has no room. */
  prefer?: Side;
  tone?: "note" | "error";
  /**
   * Shows a "Got it" button, so it is plain how to put it away. While the
   * tutorial waits for a tap, the press is handled by its tap listener like a
   * tap anywhere else; otherwise `onDismiss` handles it.
   */
  dismissable?: boolean;
  onDismiss?: () => void;
}

interface Placed {
  left: number;
  top: number;
  /** Where the notch sits along the side facing the square. */
  arrow: number;
  side: Side | "centre";
}

/** Room kept between the bubble and the board area's edges, and the square. */
const EDGE = 4;
const GAP = 8;

/** The sides to try, preferred first, when one has no room. */
const FALLBACK: Record<Side, Side[]> = {
  above: ["above", "below", "right", "left"],
  below: ["below", "above", "right", "left"],
  right: ["right", "left", "above", "below"],
  left: ["left", "right", "above", "below"],
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/**
 * A short line floating over the board, pointing at one square. Absolutely
 * positioned inside its parent, the board area, so it never moves the
 * layout; placed beside the square rather than on it, and kept inside the
 * board's bounds.
 */
export function Bubble({ cell, anchor, text, prefer = "above", tone = "note", dismissable = false, onDismiss }: BubbleProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);

  useLayoutEffect(() => {
    // The board area it sits in (read off the DOM: a parent's ref is not set
    // yet when a child's layout effect first runs).
    const host = ref.current?.parentElement ?? null;
    function place() {
      const el = ref.current;
      if (host === null || el === null) return;
      const a = host.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const selector = anchor ?? (cell === null ? null : `[data-cell="${cell}"]`);
      const target = selector === null ? null : host.querySelector(selector);
      if (target === null) {
        setPlaced({ left: (a.width - b.width) / 2, top: a.height * 0.3 - b.height / 2, arrow: 0, side: "centre" });
        return;
      }
      const r = target.getBoundingClientRect();
      // The square, relative to the board area.
      const c = { left: r.left - a.left, top: r.top - a.top, right: r.right - a.left, bottom: r.bottom - a.top };
      const cx = (c.left + c.right) / 2;
      const cy = (c.top + c.bottom) / 2;
      const room: Record<Side, boolean> = {
        above: anchor !== undefined || c.top >= b.height + GAP,
        below: a.height - c.bottom >= b.height + GAP,
        right: a.width - c.right >= b.width + GAP + EDGE,
        left: c.left >= b.width + GAP + EDGE,
      };
      const side = FALLBACK[prefer].find((s) => room[s]) ?? prefer;
      if (side === "above" || side === "below") {
        const left = clamp(cx - b.width / 2, EDGE, a.width - b.width - EDGE);
        const top = side === "above" ? c.top - b.height - GAP : c.bottom + GAP;
        setPlaced({ left, top, arrow: clamp(cx - left, 12, b.width - 12), side });
      } else {
        const top = clamp(cy - b.height / 2, EDGE, a.height - b.height - EDGE);
        // Clamped too: with no side roomy enough this is the fallback, and it
        // must still stay on the board.
        const left = clamp(side === "right" ? c.right + GAP : c.left - b.width - GAP, EDGE, a.width - b.width - EDGE);
        setPlaced({ left, top, arrow: clamp(cy - top, 10, b.height - 10), side });
      }
    }
    place();
    window.addEventListener("resize", place);
    // The board pans and zooms inside its own scrolling viewport...
    host?.addEventListener("scroll", place, true);
    // ...and a zoom that scrolls nothing still resizes the squares.
    const selector = anchor ?? (cell === null ? null : `[data-cell="${cell}"]`);
    const target = selector === null ? null : (host?.querySelector(selector) ?? null);
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (host !== null) resized?.observe(host);
    if (target !== null) resized?.observe(target);
    return () => {
      window.removeEventListener("resize", place);
      host?.removeEventListener("scroll", place, true);
      resized?.disconnect();
    };
  }, [cell, anchor, text, prefer]);

  return (
    <div
      ref={ref}
      role="status"
      className={[styles.bubble, tone === "error" ? styles.bubbleError : ""].join(" ")}
      data-side={placed?.side}
      data-placed={placed === null ? undefined : ""}
      data-points-at={cell ?? undefined}
      // Computed from the square's position: the one thing CSS cannot know.
      style={
        placed === null
          ? undefined
          : ({ left: placed.left, top: placed.top, "--arrow": `${placed.arrow}px` } as CSSProperties)
      }
    >
      <span>{text}</span>
      {dismissable && (
        <button type="button" className={styles.bubbleButton} onClick={onDismiss}>
          Got it
        </button>
      )}
    </div>
  );
}
