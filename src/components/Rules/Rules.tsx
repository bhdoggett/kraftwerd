import { useState } from "react";
import {
  BAG_SIZE,
  BLANKS_PER_GAME,
  DICTIONARY_WORDS,
  LONG_WORD_BONUS,
  LONG_WORD_MIN,
  RACK,
  SCORING_SQUARE_SIZE,
  SQUARE_BONUS,
} from "../../../shared/config";
import TWO_LETTER_WORDS from "../../../shared/data/two-letter-words.json";
import { DoubleWordIcon, QuadWordIcon, TripleWordIcon } from "../Icons/Icons";
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
  const [showWordList, setShowWordList] = useState(false);

  if (showWordList) {
    return (
      <Modal wide onDismiss={() => setShowWordList(false)}>
        <div className={styles.body}>
          <div className={styles.head}>
            <h2 className={styles.title}>Word list</h2>
            <button type="button" className={styles.close} onClick={onClose}>
              Close
            </button>
          </div>

          <p>
            <button
              type="button"
              className={styles.textLink}
              onClick={() => setShowWordList(false)}
            >
              ← Back to rules
            </button>
          </p>

          <p>
            Kraftwerd checks plays against a word-game dictionary, not a
            general-purpose one — built from two public-domain sources made
            for word games, ENABLE and 12dicts' <em>3of6game</em>.{" "}
            <strong>{DICTIONARY_WORDS.toLocaleString()} words</strong> in
            all.
          </p>
          <ul>
            <li>
              <strong>Two-letter words are their own hand-picked list</strong>{" "}
              — {TWO_LETTER_WORDS.length} of them, chosen for what a word-game
              player expects (QI, ZA, XI) rather than what a general
              dictionary happens to offer instead.
            </li>
            <li>
              Loanwords play by the plain-letter spelling a tile can actually
              make — <strong>CAFE</strong>, <strong>CLICHE</strong>,{" "}
              <strong>ENTREE</strong> — since accents aren't filtered, they're
              just stripped.
            </li>
            <li>
              Ordinary profanity plays — it's not filtered. Slurs are, no
              matter how the word is being used.
            </li>
          </ul>
        </div>
      </Modal>
    );
  }

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
            The <strong>first word must cover the center square</strong>,
            marked with a small dot. It's a ×2, so the opening word is
            doubled.
          </li>
          <li>
            <strong>Marked squares multiply a word</strong> played across
            them — once each, first come first served, worth more the
            closer to a corner:
          </li>
        </ul>
        <div className={styles.markLegend}>
          <span className={styles.markLegendRow}>
            <DoubleWordIcon />
            ×2
          </span>
          <span className={styles.markLegendRow}>
            <TripleWordIcon />
            ×3
          </span>
          <span className={styles.markLegendRow}>
            <QuadWordIcon />
            ×4
          </span>
        </div>

        <h3 className={styles.section}>Moves</h3>
        <ul>
          <li>
            Play as many words as your rack allows. Real words only (see{" "}
            <button
              type="button"
              className={styles.textLink}
              onClick={() => setShowWordList(true)}
            >
              word list details
            </button>
            ).
          </li>
          <li>Every play must touch what's already on the board.</li>
          <li>
            <strong>Stack tiles to build new words</strong> — CAT becomes
            COT. Once a square's been stacked, its letter is locked in for
            good.
          </li>
          <li>
            <strong>Stacking has limits</strong> — blanks can't stack, you
            can't place the same letter that's already there, and you can't
            stack completely over another word (at least one original
            letter must remain).
          </li>
          <li>
            <strong>One free swap a game</strong> — trade in your whole rack
            for new letters and still play that turn. It's all or nothing,
            and your old letters go back in the bag first, so some may come
            back.
          </li>
          <li>
            <strong>Pass</strong> if you can't play.
          </li>
        </ul>

        <h3 className={styles.section}>Points</h3>
        <p>
          Every tile you place is <strong>one point</strong>, letters
          already there included — plus bonuses:
        </p>
        <ul className={styles.bonusList}>
          <li>
            <strong className={styles.bonusAmount}>
              +{LONG_WORD_BONUS}:
            </strong>{" "}
            Playing a word of {LONG_WORD_MIN} letters or more that's new or
            longer — not one you only restacked letters inside.
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
          Once the bag is empty, everyone plays out their tiles. You're{" "}
          <strong>out</strong> when you've played every tile you hold,
          blanks included, and your turns are skipped from then on.
          The game ends when <strong>everyone is out</strong>, or when a{" "}
          <strong>full round goes by with nobody playing</strong> — so if
          you're the last one holding tiles and you pass, that's the end.
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
