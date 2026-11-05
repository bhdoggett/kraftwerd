import { Modal } from "../Modal/Modal";
import styles from "./Game.module.css";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

interface BlankPickerProps {
  onPick: (letter: string) => void;
  /** Pressing away takes the blank back. */
  onDismiss: () => void;
  /** A letter to point out (the tutorial's hint): it pulses like the blank. */
  suggest?: string;
}

/** What a blank just dropped on the board stands for. */
export function BlankPicker({ onPick, onDismiss, suggest }: BlankPickerProps) {
  const letterButton = (letter: string) => (
    <button
      key={letter}
      type="button"
      className={[styles.blankLetter, letter === suggest ? styles.blankLetterSuggested : ""].join(" ")}
      data-suggested={letter === suggest ? "" : undefined}
      onClick={() => onPick(letter)}
    >
      {letter}
    </button>
  );
  return (
    // Pressing away takes the blank back, which is what the button
    // under the letters used to say in words.
    <Modal onDismiss={onDismiss} label="Choose a letter for the blank">
      <div className={styles.popover}>
        <p className={styles.popoverTitle}>What does this blank stand for?</p>
        <div className={styles.letterGrid}>{ALPHABET.slice(0, 20).map(letterButton)}</div>
        <div className={styles.letterGridLast}>{ALPHABET.slice(20).map(letterButton)}</div>
      </div>
    </Modal>
  );
}
