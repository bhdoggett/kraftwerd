import { useState } from "react";
import { RACK } from "../../../shared/config";
import { newBag, tilesLeft } from "../../../shared/engine/bag";
import styles from "./BagContents.module.css";

/**
 * What is still out there, letter by letter, against the full starting count
 * -- each letter a small gauge filled in proportion to how much of it is
 * unaccounted for, rather than a fraction to do arithmetic on. The exact
 * numbers are on hover and for a screen reader; the tile itself is meant to
 * be read at a glance, the way an emptying tank is.
 *
 * "Still out there" is not "still in the bag", and the wording matters. What
 * is drawn here is the bag *and* the other players' hands together, which is
 * exactly what anyone could work out by counting the board against the
 * starting letters. What is in the bag alone is never shown and never sent:
 * board, your own rack and the bag account for every tile in the game, so
 * knowing all three gives you the other players' racks by subtraction -- in
 * a two-hander, the opponent's whole rack, letter for letter, every turn.
 *
 * The headline count is the bag's own, which is public on its own: how many
 * tiles are left to draw says nothing about which.
 */
export function BagContents({
  left,
  unseen,
}: {
  /** Tiles still in the bag. The count is public; the contents are not. */
  left: number;
  /** The bag and the other hands together, by letter. */
  unseen: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const full = newBag(RACK);
  const total = tilesLeft(full);

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
          <p className={styles.note}>
            Still out there — in the bag or in somebody's hand:
          </p>
          <div className={styles.letters}>
            {letters.map(([letter, startingCount]) => {
              const outThere = unseen[letter] ?? 0;
              const fill = startingCount === 0 ? 0 : outThere / startingCount;
              return (
                <span
                  key={letter}
                  className={styles.letter}
                  style={{ "--fill": fill } as React.CSSProperties}
                  title={`${outThere} of ${startingCount} still out there`}
                  aria-label={`${letter}: ${outThere} of ${startingCount} still out there`}
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
