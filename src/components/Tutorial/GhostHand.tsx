import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import styles from "./Tutorial.module.css";

interface GhostHandProps {
  /** The tile to show being dragged: a letter, or the blank. */
  letter: string;
  isBlank: boolean;
  /** The ghost it goes to, as `x,y`. */
  cell: string;
}

/**
 * The drag, shown rather than told: a see-through tile and a fingertip
 * gliding from the rack to the ghost, over and over, until the player
 * touches a tile. Fixed to the viewport, since it spans the rack and the
 * board; gone when motion is turned down (the ghosts still pulse).
 */
export function GhostHand({ letter, isBlank, cell }: GhostHandProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);

  useLayoutEffect(() => {
    function place() {
      const rack = document.querySelector("[data-rack]");
      const from = isBlank
        ? rack?.querySelector("[data-face=blank]")
        : [...(rack?.querySelectorAll("button") ?? [])].find(
            (b) => b.textContent === letter && getComputedStyle(b).visibility !== "hidden",
          );
      const to = document.querySelector(`[data-cell="${cell}"]`);
      if (from === null || from === undefined || to === null) return setPath(null);
      const f = from.getBoundingClientRect();
      const t = to.getBoundingClientRect();
      const x = f.left + f.width / 2;
      const y = f.top + f.height / 2;
      setPath({ x, y, dx: t.left + t.width / 2 - x, dy: t.top + t.height / 2 - y });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [letter, isBlank, cell]);

  if (path === null) return null;
  return (
    <div
      ref={ref}
      className={styles.hand}
      data-hand=""
      aria-hidden="true"
      // Computed from where the tile and its ghost are on screen.
      style={
        {
          left: path.x,
          top: path.y,
          "--hand-dx": `${path.dx}px`,
          "--hand-dy": `${path.dy}px`,
        } as CSSProperties
      }
    >
      <span className={[styles.handTile, isBlank ? styles.handBlank : ""].join(" ")} data-seat="1">
        {isBlank ? "" : letter}
      </span>
      <span className={styles.handFinger} />
    </div>
  );
}
