import { BLANKS_PER_GAME, RACK, STACK_CAP } from "../../shared/config";
import { MiniBoard } from "./MiniBoard";
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
          <li>
            A tile may be laid <strong>on top of a tile already
            there</strong>, so long as every word it leaves still reads:
            CAT becomes COT, but never CZT. The words you make that way
            score in full, like any others — so a board tangled beyond
            playing is never quite stuck.
          </li>
          <li>
            A word already on the board must <strong>keep at least one of
            its letters</strong>. You can build over CAT to make COT, but
            you cannot pave the whole word over and start again.
          </li>
          <li>
            A tile laid on another has to <strong>change the letter
            underneath</strong>. Laying an A back on an A leaves the board
            as it was and would collect for the same words twice.
          </li>
          <li>
            A square can only take so much traffic: once{" "}
            <strong>{STACK_CAP} tiles</strong> have landed on it, it is
            full and nobody may play there again.
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
        <div className={styles.diagrams}>
          <MiniBoard
            rows={["RISE."]}
            seat={1}
            caption="RISE, already on the board."
          />
          <MiniBoard
            rows={["RISEN"]}
            seat={1}
            played={["4,0"]}
            ring={["4,0"]}
            caption="One tile makes RISEN, and scores all five letters."
          />
        </div>
        <p>
          Landing on a square that already has a tile on it pays{" "}
          <strong>+2</strong> on top of the word. That fills the square, and
          a full square is out of play for good — it goes back to bare board
          with its letter lit in the colour of whoever closed it.
        </p>
        <div className={styles.diagrams}>
          <MiniBoard rows={["CAT"]} seat={1} caption="CAT." />
          <MiniBoard
            rows={["COT"]}
            seat={1}
            played={["1,0"]}
            full={["1,0"]}
            ring={["1,0"]}
            caption="An O on the A makes COT: three for the word, +2 for the tile on top."
          />
        </div>

        <h3 className={styles.section}>Scoring: squares</h3>
        <p>
          Any solid block of tiles scores again on the turn it is
          completed: <strong>a k×k block is worth k²</strong>, and bigger
          blocks contain smaller ones, which all count.
        </p>
        <div className={styles.diagrams}>
          <MiniBoard
            rows={["AT", "TO"]}
            seat={1}
            played={["1,1"]}
            ring={["0,0", "1,0", "0,1", "1,1"]}
            caption="A 2×2: four two-letter words, and 4 again for the block. 12 in all."
          />
          <MiniBoard
            rows={["CAT", "ARE", "TEN"]}
            seat={1}
            played={["2,2"]}
            ring={["0,0", "1,0", "2,0", "0,1", "1,1", "2,1", "0,2", "1,2", "2,2"]}
            caption="A 3×3 holds four 2×2s as well as itself: 6 words + 16 + 9 = 43."
          />
        </div>
        <p>
          A square is scored by <strong>whoever places its final
          tile</strong>, no matter who placed the rest — so leaving a
          corner open is dangerous.
        </p>
        <p>
          Each square pays <strong>once</strong>. Replacing a letter inside
          a block that was already complete scores nothing for it; only a
          block that was not there at the start of your turn pays.
        </p>

        <h3 className={styles.section}>Blanks</h3>
        <p>
          You get {BLANKS_PER_GAME} for the whole game. Drop one, then choose
          the letter it stands for. Once it has a letter it is an ordinary
          tile — it <strong>scores its point</strong> and wears your colour
          like any other.
        </p>
        <p>
          The one thing a blank may not do is{" "}
          <strong>land on top of another tile</strong>. A square takes one tile
          on top and is then full, and the tile that closes it has to be a
          letter you actually drew.
        </p>

        <h3 className={styles.section}>Trading and passing</h3>
        <p>
          Swap any tiles for new ones with the trade button on the rack.
          Trading <strong>gives up your turn</strong>.
        </p>
        <p>
          Once the bag is empty there is nothing to trade for, and the same
          button becomes <strong>Pass</strong> — for the hand that will not
          play anywhere. Enough passes in a row and the game ends.
        </p>

        <h3 className={styles.section}>Ending</h3>
        <p>
          There is <strong>one bag of tiles</strong> for the table, and the
          game runs until it is gone. Once the bag is empty everyone plays out
          what is left in their hand, and the moment somebody empties theirs,
          the game stops — the others do not get another turn.
        </p>
        <p>
          Whoever goes out <strong>takes a point for every tile</strong> still
          in everyone else's hands, and they each lose the same. So a Q you
          never played costs you twice. Highest score wins; quitting hands the
          win to whoever is left.
        </p>
      </div>
    </Modal>
  );
}
