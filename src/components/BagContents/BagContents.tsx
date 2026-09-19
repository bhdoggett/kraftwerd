import { useState } from "react";
import { RACK } from "../../../shared/config";
import { newBag, tilesLeft } from "../../../shared/engine/bag";
import styles from "./BagContents.module.css";

/**
 * What is still out there, letter by letter, against the full starting count
 * -- each letter a small gauge filled in proportion to how much of it is
 * unaccounted for, rather than a fraction to do arithmetic on. The tile is
 * meant to be read at a glance, the way an emptying tank is; the exact number
 * is a tap away for whoever wants to check.
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
  /**
   * Which letter is showing its number. One at a time: this sits in a narrow
   * panel, and 26 popovers at once is the wall of text the gauges replaced.
   */
  const [asked, setAsked] = useState<string | null>(null);
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
              const says = `${outThere} of ${startingCount} still out there`;
              return (
                /*
                 * A button because it is tapped, not because it looks like
                 * one: the count lived in `title` alone, which is a tooltip,
                 * and a tooltip needs a pointer to hover. On a phone the
                 * gauges could say "some" and "hardly any" and nothing else.
                 * The styling deliberately keeps it a tile -- see .letter in
                 * the stylesheet, which strips every button affordance.
                 */
                <button
                  type="button"
                  key={letter}
                  className={styles.letter}
                  style={{ "--fill": fill } as React.CSSProperties}
                  title={says}
                  aria-label={`${letter}: ${says}`}
                  onClick={() => setAsked(asked === letter ? null : letter)}
                >
                  {letter}
                  {asked === letter && (
                    <span className={styles.popover} role="status">
                      {says}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
