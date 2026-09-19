import {
  BAG_SIZE,
  BLANKS_PER_GAME,
  GAME,
  LONG_WORD_BONUS,
  LONG_WORD_MIN,
  RACK,
  RACK_CLEAR_BONUS,
  SCORING_SQUARE_SIZE,
  SQUARE_BONUS,
  STACK_CAP,
} from "../../../shared/config";
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

        <p>Kraftwerd is a new twist on the word game.</p>

        <h3 className={styles.section}>Rack</h3>
        <ul>
          <li>
            You hold <strong>{RACK.size} letters</strong>, drawn from a pool
            of {BAG_SIZE}, refilled after every play.
          </li>
          <li>
            <strong>{BLANKS_PER_GAME} blanks for the whole game</strong> —
            assign any letter and it plays like one you drew. Once spent,
            gone.
          </li>
        </ul>

        <h3 className={styles.section}>Board</h3>
        <ul>
          <li>
            {GAME.boardSize}×{GAME.boardSize} —{" "}
            {GAME.boardSize * GAME.boardSize} squares.
          </li>
          <li>
            The <strong>first word must cover the center square</strong>,
            marked in green.
          </li>
          <li>
            <strong>Shaded squares double</strong> a word played across them,
            in either direction — once each, first come first served.
          </li>
        </ul>

        <h3 className={styles.section}>Moves</h3>
        <ul>
          <li>
            Play as many words as your rack allows. Every run of two or more
            tiles, across or down, has to be a real word.
          </li>
          <li>
            Everything after the first word must{" "}
            <strong>touch what's already on the board</strong>, edge to
            edge.
          </li>
          <li>
            <strong>Land on a tile that's already there</strong> to build a
            new word — CAT becomes COT, never CZT, never the same letter
            twice — as long as what's underneath keeps at least one of its
            own letters. Blanks can't do this.
          </li>
          <li>
            Once <strong>{STACK_CAP} tiles</strong> have landed on a square,
            it's full and closed to further play.
          </li>
          <li>
            No play? <strong>Trade tiles</strong> for new ones, or — once the
            bag runs dry — <strong>pass</strong>.
          </li>
        </ul>

        <h3 className={styles.section}>Points</h3>
        <p>
          Every tile you place is <strong>one point</strong>, letters
          already there included — plus bonuses:
        </p>
        <ul className={styles.bonusList}>
          <li>
            <strong className={styles.bonusAmount}>+2:</strong> Landing on a
            tile that's already there.
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
          </li>
          <li>
            <strong className={styles.bonusAmount}>
              +{LONG_WORD_BONUS}:
            </strong>{" "}
            Playing a word of {LONG_WORD_MIN} letters or more.
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
                caption={`One tile makes RISEN: 5 + ${LONG_WORD_BONUS} = ${
                  5 + LONG_WORD_BONUS
                }.`}
              />
            </div>
          </li>
          <li>
            <strong className={styles.bonusAmount}>
              +{RACK_CLEAR_BONUS}:
            </strong>{" "}
            Playing every tile in your rack in one turn.
          </li>
          <li>
            <strong className={styles.bonusAmount}>+{SQUARE_BONUS}:</strong>{" "}
            Completing a {SCORING_SQUARE_SIZE}×{SCORING_SQUARE_SIZE} block of
            tiles — scored by whoever places the final tile, no matter who
            placed the rest.
            <div className={styles.diagrams}>
              <MiniBoard
                rows={["CAT", "ARE", "TEN"]}
                seat={1}
                played={["2,2"]}
                ring={[
                  "0,0",
                  "1,0",
                  "2,0",
                  "0,1",
                  "1,1",
                  "2,1",
                  "0,2",
                  "1,2",
                  "2,2",
                ]}
                caption={`A 3×3: six words (18) plus ${SQUARE_BONUS} for the block — ${
                  18 + SQUARE_BONUS
                } in all.`}
              />
            </div>
          </li>
        </ul>

        <h3 className={styles.section}>Ending</h3>
        <p>
          The game runs until the bag is empty. The moment it is,{" "}
          <strong>everyone still playing gets one more turn</strong> — a
          final turn can be a pass.
        </p>
        <p>
          <strong>Tiles left in hand settle for nothing</strong> — your
          score is exactly what you scored. Highest total wins;{" "}
          <strong>quitting ends the game on the spot</strong>, mid-round if
          that's where it falls.
        </p>
      </div>
    </Modal>
  );
}
