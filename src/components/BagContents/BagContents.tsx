import { useState } from "react";
import { RACK } from "../../../shared/config";
import { newBag, tilesLeft } from "../../../shared/engine/bag";
import styles from "./BagContents.module.css";

/**
 * What is actually left in the bag, letter by letter, against the full
 * starting count -- each letter a small gauge, filled in proportion to how
 * much of it remains, rather than a fraction to do arithmetic on. The exact
 * numbers are still there, on hover and for a screen reader, for anyone who
 * wants them; the tile itself is meant to be read at a glance, the way an
 * emptying tank is.
 */
export function BagContents({ remaining }: { remaining: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const full = newBag(RACK);
  const total = tilesLeft(full);
  const left = tilesLeft(remaining);

  const letters = Object.entries(full).sort(
    ([a, na], [b, nb]) => nb - na || a.localeCompare(b),
  );

  return (
    <div className={styles.bag}>
      <button
        type="button"
        className={styles.summary}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>
          <strong>{left}</strong> of {total} tiles left
        </span>
        <span className={styles.chevron}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <>
          <p className={styles.note}>Left in the bag, out of the starting count:</p>
          <div className={styles.letters}>
            {letters.map(([letter, startingCount]) => {
              const remainingCount = remaining[letter] ?? 0;
              const fill = startingCount === 0 ? 0 : remainingCount / startingCount;
              return (
                <span
                  key={letter}
                  className={styles.letter}
                  style={{ "--fill": fill } as React.CSSProperties}
                  title={`${remainingCount} of ${startingCount} left`}
                  aria-label={`${letter}: ${remainingCount} of ${startingCount} left`}
                >
                  {letter}
                </span>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
