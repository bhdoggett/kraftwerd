import { BLANKS_PER_GAME, RACK, RACK_CLEAR_BONUS, STACK_CAP } from "../../../shared/config";
import { MiniBoard } from "../MiniBoard/MiniBoard";
import { Modal } from "../Modal/Modal";
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
          Words score a point a letter, in both directions. Fill a 2×2 block
          of tiles and take 4 more — a 3×3 takes 9.
        </p>

        <h3 className={styles.section}>Placing tiles</h3>
        <ul>
          <li>
            You hold {RACK.size} letters, refilled after every play, plus{" "}
            <strong>{BLANKS_PER_GAME} blanks for the whole game</strong> —
            once spent, gone.
          </li>
          <li>
            The <strong>first word must cover the center square</strong>,
            marked in green.
          </li>
          <li>
            Everything after that must <strong>touch what's already on the
            board</strong>, edge to edge — corners don't count.
          </li>
          <li>
            Every run of two or more tiles, across and down, has to be a
            word.
          </li>
          <li>
            A tile may land <strong>on a tile already there</strong> as long
            as every word it leaves still reads: CAT becomes COT, never CZT.
            Those words score in full — so the board is never truly stuck.
          </li>
          <li>
            A word on the board must <strong>keep at least one
            letter</strong>. Build CAT into COT, but you can't replace the
            whole word.
          </li>
          <li>
            A tile placed on another must <strong>change the letter
            underneath</strong> — replacing an A with an A would score the
            same words twice.
          </li>
          <li>
            Once <strong>{STACK_CAP} tiles</strong> have landed on a square,
            it's full and closed to further play.
          </li>
        </ul>

        <h3 className={styles.section}>Scoring: words</h3>
        <p>
          A word scores <strong>one point per letter, including letters
          already there</strong>. A crossing letter is paid in both words.
        </p>
        <p>
          So adding one tile to <strong>RISE</strong> scores{" "}
          <strong>RISEN</strong> in full — five points for one tile. An
          extendable word is a gift to whoever plays next.
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
            caption="One tile makes RISEN and scores all five letters."
          />
        </div>
        <p>
          Landing on a tile that's already there pays <strong>+2</strong> on
          top of the word, and fills the square for good — it goes bare
          again, its letter lit in the color of whoever closed it.
        </p>
        <div className={styles.diagrams}>
          <MiniBoard rows={["CAT"]} seat={1} caption="CAT." />
          <MiniBoard
            rows={["COT"]}
            seat={1}
            played={["1,0"]}
            full={["1,0"]}
            ring={["1,0"]}
            caption="An O on the A makes COT: 3 for the word, +2 for the tile on top."
          />
        </div>
        <p>
          <strong>Emptying your rack</strong> pays a flat{" "}
          <strong>+{RACK_CLEAR_BONUS}</strong> on top of everything else —
          worth chasing even with no square in reach.
        </p>

        <h3 className={styles.section}>Scoring: squares</h3>
        <p>
          A gapless block of tiles scores again the turn it's completed:{" "}
          <strong>a k×k block is worth k²</strong> — 4 for a 2×2, 9 for a
          3×3 — and bigger blocks count their smaller ones too.
        </p>
        <div className={styles.diagrams}>
          <MiniBoard
            rows={["AT", "TO"]}
            seat={1}
            played={["1,1"]}
            ring={["0,0", "1,0", "0,1", "1,1"]}
            caption="A 2×2: four two-letter words plus 4 for the block — 12 in all."
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
          tile</strong> — no matter who placed the rest, so leaving a corner
          open is risky.
        </p>
        <p>
          Each square pays <strong>once</strong>. Replacing a letter inside
          an already-complete block scores nothing more; only a newly
          completed block pays.
        </p>

        <h3 className={styles.section}>Blanks</h3>
        <p>
          You get {BLANKS_PER_GAME} for the whole game. Play one, then choose
          its letter. Once assigned, it's an ordinary tile — it{" "}
          <strong>scores its point</strong> and wears your color like any
          other.
        </p>
        <p>
          A blank alone can't <strong>land on another tile</strong> — the
          tile that closes a square has to be a letter you actually drew.
        </p>

        <h3 className={styles.section}>Trading and passing</h3>
        <p>
          Swap any tiles for new ones with the trade button on the rack.
          Trading <strong>gives up your turn</strong>.
        </p>
        <p>
          Once the bag is empty, the same button becomes{" "}
          <strong>Pass</strong> — for a hand that can't play. Enough passes
          in a row ends the game.
        </p>

        <h3 className={styles.section}>Ending</h3>
        <p>
          <strong>One bag of tiles</strong> serves the whole table. The
          moment someone draws the last one, that's their final turn —
          whatever they're still holding — and{" "}
          <strong>everyone else gets one more turn</strong> each, so the
          game always ends with equal turns played. A final turn can be a
          pass.
        </p>
        <p>
          <strong>Nothing is settled for tiles left in hand</strong> — your
          score is exactly what you scored. Highest total wins; quitting
          hands the win to whoever remains.
        </p>
      </div>
    </Modal>
  );
}
