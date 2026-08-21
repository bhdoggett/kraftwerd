import { BLANKS_PER_GAME, GAME, RACK } from "../../shared/config";
import { Modal } from "./Modal";
import styles from "./Rules.module.css";

interface RulesDialogProps {
  onClose: () => void;
}

/**
 * The rules, kept next to the game rather than in a document nobody opens.
 *
 * Numbers come from the shared config, so a balance change cannot leave this
 * quietly describing a game that no longer exists.
 *
 * Opening is the menu's business; this is only the dialog.
 */
export function RulesDialog({ onClose }: RulesDialogProps) {
  return (
    <Modal wide onDismiss={onClose}>
      <div className={styles.body}>
        <div className={styles.head}>
          <h2 className={styles.title}>How to play</h2>
          <button type="button" className={styles.close} onClick={onClose}>
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
            You hold {RACK.size} letters, refilled after every play, and{" "}
            <strong>{BLANKS_PER_GAME} blanks for the whole game</strong> —
            once spent, they are gone.
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
            word.
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
          You get {BLANKS_PER_GAME} for the whole game. Drop one, then
          choose the letter it stands for. It counts for words and squares
          but is <strong>worth no points itself</strong>, and it is not
          replaced — spending one is a decision about when.
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
    </Modal>
  );
}
