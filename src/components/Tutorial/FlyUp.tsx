import { useLayoutEffect, useRef, useState } from "react";
import styles from "./Tutorial.module.css";

/**
 * A big moment, said with a number rising off the board: "+33" from a closed
 * 3×3, "Out!" from the last tile. Positioned over a square inside its
 * parent, the board area; it plays once and is purely for show (the scores
 * say the same thing in words).
 */
export function FlyUp({ cell, text }: { cell: string; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    const target = host?.querySelector(`[data-cell="${cell}"]`);
    if (host === undefined || host === null || target === null || target === undefined) return;
    const a = host.getBoundingClientRect();
    const c = target.getBoundingClientRect();
    setAt({ left: c.left - a.left + c.width / 2, top: c.top - a.top + c.height / 2 });
  }, [cell]);

  return (
    <div
      ref={ref}
      className={styles.flyUp}
      data-placed={at === null ? undefined : ""}
      aria-hidden="true"
      // Computed from the square's position.
      style={at === null ? undefined : ({ left: at.left, top: at.top })}
    >
      {text}
    </div>
  );
}
