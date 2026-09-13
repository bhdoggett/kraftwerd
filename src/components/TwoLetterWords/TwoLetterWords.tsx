import TWO_LETTER_WORDS from "../../../shared/data/two-letter-words.json";
import { Modal } from "../Modal/Modal";
import styles from "./TwoLetterWords.module.css";

interface TwoLetterWordsDialogProps {
  onClose: () => void;
}

/**
 * The full curated two-letter list, shown rather than left to be learned by
 * getting told "not a word" — a 2x2 is four of these, so this list alone
 * decides how many squares exist at all (design.md §5.2).
 */
export function TwoLetterWordsDialog({ onClose }: TwoLetterWordsDialogProps) {
  return (
    <Modal onDismiss={onClose}>
      <div className={styles.body}>
        <div className={styles.head}>
          <h2 className={styles.title}>Two-letter words</h2>
          <button type="button" className={styles.close} onClick={onClose}>
            Close
          </button>
        </div>
        <p className={styles.intro}>
          The only two-letter words the board accepts — {TWO_LETTER_WORDS.length} of
          them. Everything you need for a 2×2 is in here.
        </p>
        <ul className={styles.grid}>
          {TWO_LETTER_WORDS.map((word) => (
            <li key={word} className={styles.word}>
              {word}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
