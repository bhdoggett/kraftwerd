import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import styles from "./Tutorial.module.css";

interface BubbleProps {
  /** The board area: what the bubble is positioned in, and where the cell is found. */
  area: RefObject<HTMLElement | null>;
  /** The square pointed at, as `x,y`; null for a bubble centred over the board. */
  cell: string | null;
  text: string;
  /** Which side of the square to try first; the other is used if this one has no room. */
  prefer?: "above" | "below";
  tone?: "note" | "error";
}

interface Placed {
  left: number;
  top: number;
  arrow: number;
  side: "above" | "below" | "centre";
}

/** Room kept between the bubble and the board area's edges, and the square. */
const EDGE = 4;
const GAP = 8;

/**
 * A short line floating over the board, pointing at one square. Absolutely
 * positioned inside the board area, so it never moves the layout; placed above
 * or below the square rather than on it, and kept inside the board's width.
 */
export function Bubble({ area, cell, text, prefer = "above", tone = "note" }: BubbleProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);

  useLayoutEffect(() => {
    const host = area.current;
    function place() {
      const el = ref.current;
      if (host === null || el === null) return;
      const a = host.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const target = cell === null ? null : host.querySelector(`[data-cell="${cell}"]`);
      if (target === null) {
        setPlaced({ left: (a.width - b.width) / 2, top: a.height * 0.3 - b.height / 2, arrow: 0, side: "centre" });
        return;
      }
      const c = target.getBoundingClientRect();
      const cx = c.left - a.left + c.width / 2;
      const roomAbove = c.top - a.top >= b.height + GAP;
      const roomBelow = a.bottom - c.bottom >= b.height + GAP;
      const side = prefer === "above" ? (roomAbove || !roomBelow ? "above" : "below") : roomBelow || !roomAbove ? "below" : "above";
      const top = side === "above" ? c.top - a.top - b.height - GAP : c.bottom - a.top + GAP;
      const left = Math.max(EDGE, Math.min(cx - b.width / 2, a.width - b.width - EDGE));
      setPlaced({ left, top, arrow: Math.max(12, Math.min(cx - left, b.width - 12)), side });
    }
    place();
    window.addEventListener("resize", place);
    // The board pans and zooms inside its own scrolling viewport.
    host?.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      host?.removeEventListener("scroll", place, true);
    };
  }, [area, cell, text, prefer]);

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
          : ({ left: placed.left, top: placed.top, "--arrow-x": `${placed.arrow}px` } as CSSProperties)
      }
    >
      {text}
    </div>
  );
}
