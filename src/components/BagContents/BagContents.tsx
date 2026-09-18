import { useState } from "react";
import { RACK } from "../../../shared/config";
import { newBag, tilesLeft as sumBag } from "../../../shared/engine/bag";
import styles from "./BagContents.module.css";

interface BagContentsProps {
  /** The real bag's size -- what the header counts down, and what decides
   * when the game moves into its last round. Not the same total as
   * `remaining` below; see that prop for why. */
  tilesLeft: number;
  /**
   * Not what's literally in the bag -- the bag plus everyone else's hand,
   * combined and undivided between them, which is what's actually still
   * "out there" as far as a player can tell (see `remainingLetters` in
   * convex/games.ts). Its total runs ahead of `tilesLeft` by however many
   * tiles are currently sitting in hands rather than in the bag itself,
   * which is expected, not a bug: the header answers "how far through the
   * game," this answers "what could still turn up."
   */
  remaining: Record<string, number>;
}

/**
 * Each letter a small gauge, filled in proportion to how much of it is not
 * yet played, rather than a fraction to do arithmetic on. The exact numbers
 * are still there, on hover and for a screen reader, for anyone who wants
 * them; the tile itself is meant to be read at a glance, the way an
 * emptying tank is.
 */
export function BagContents({ tilesLeft, remaining }: BagContentsProps) {
  const [open, setOpen] = useState(false);
  const full = newBag(RACK);
  const total = sumBag(full);

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
          <strong>{tilesLeft}</strong> of {total} tiles left
        </span>
        <span className={styles.chevron}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <>
          <p className={styles.note}>Not yet played, out of the starting count:</p>
          <div className={styles.letters}>
            {letters.map(([letter, startingCount]) => {
              const remainingCount = remaining[letter] ?? 0;
              const fill = startingCount === 0 ? 0 : remainingCount / startingCount;
              return (
                <span
                  key={letter}
                  className={styles.letter}
                  style={{ "--fill": fill } as React.CSSProperties}
                  title={`${remainingCount} of ${startingCount} not yet played`}
                  aria-label={`${letter}: ${remainingCount} of ${startingCount} not yet played`}
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
