import { useState } from "react";
import { GAME, RACK } from "../../shared/config";
import { HelpIcon } from "./Icons";
import styles from "./Rules.module.css";

/**
 * The rules, kept next to the game rather than in a document nobody opens.
 *
 * Numbers come from the shared config, so a balance change cannot leave this
 * quietly describing a game that no longer exists.
 */
export function Rules() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={styles.button}
        onClick={() => setOpen(true)}
        aria-label="How to play"
        title="How to play"
      >
        <HelpIcon />
      </button>

      {open && (
        <div
          className={styles.backdrop}
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className={styles.panel}>
            <div className={styles.head}>
              <h2 className={styles.title}>How to play</h2>
              <button type="button" className={styles.close} onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            <p>
              Build words on a crossword grid, and score again for every solid
              square of tiles you complete.
            </p>

            <h3 className={styles.section}>Placing tiles</h3>
            <ul>
              <li>
                You hold {RACK.size} letters and one blank, and may place any
                number of them in a turn.
              </li>
              <li>
                The <strong>first word must cover the centre square</strong>,
                marked in green.
              </li>
              <li>
                Everything after that must <strong>touch what is already on
                the board</strong>, edge to edge — corners do not count.
              </li>
              <li>
                Every run of two or more tiles, across and down, has to be a
                word. Blocked squares cannot be played on.
              </li>
            </ul>

            <h3 className={styles.section}>Scoring: words</h3>
            <p>
              A word scores <strong>one point per letter, counting letters
              already on the board</strong>. A letter where two words cross is
              paid for in both.
            </p>
            <p>
              So adding one tile to <strong>RISE</strong> scores{" "}
              <strong>RISEN</strong> in full: five points for one tile. Which
              means a word left extendable is a gift to whoever plays next.
            </p>

            <h3 className={styles.section}>Scoring: squares</h3>
            <p>
              Any solid block of tiles scores again on the turn it is
              completed: <strong>a k×k block is worth k²</strong>, and bigger
              blocks contain smaller ones, which all count.
            </p>
            <div className={styles.example}>
              {`2×2   4 tiles   4 words + 4          = 12
3×3   9 tiles   6 words + (4×4 + 9)  = 43`}
            </div>
            <p>
              A square is scored by <strong>whoever places its final
              tile</strong>, no matter who placed the rest — so leaving a
              corner open is dangerous.
            </p>

            <h3 className={styles.section}>Blanks</h3>
            <p>
              You always have one blank. Drop it, then choose the letter it
              stands for. It counts for words and squares but is{" "}
              <strong>worth no points itself</strong>. Use it or not, you get
              one again next turn.
            </p>

            <h3 className={styles.section}>Trading</h3>
            <p>
              Swap any tiles for new ones with the trade button on the rack.
              Trading{" "}
              <strong>gives up your turn</strong>.
            </p>

            <h3 className={styles.section}>Ending</h3>
            <p>
              The game ends once <strong>{GAME.endThreshold} tiles</strong> are
              on the board, finishing the round so everyone has had the same
              number of turns. Highest score wins. Quitting hands the win to
              whoever is left.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
