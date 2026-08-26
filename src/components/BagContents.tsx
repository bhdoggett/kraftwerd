import { useState } from "react";
import { RACK } from "../../shared/config";
import { newBag } from "../../shared/engine/bag";
import styles from "./BagContents.module.css";

/**
 * What a full bag holds, letter by letter.
 *
 * The composition is public — it is the same for every game, and knowing it
 * is part of playing well, the way a Scrabble player knows there are four Ss.
 * What stays secret is which of them are still in the bag rather than in
 * somebody's hand.
 */
export function BagContents({ left }: { left: number }) {
  const [open, setOpen] = useState(false);
  const bag = newBag(RACK);
  const total = Object.values(bag).reduce((sum, n) => sum + n, 0);

  const letters = Object.entries(bag).sort(
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
          <p className={styles.note}>What a full bag holds:</p>
          <div className={styles.letters}>
            {letters.map(([letter, count]) => (
              <span key={letter} className={styles.letter}>
                {letter}
                <span className={styles.count}>{count}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
