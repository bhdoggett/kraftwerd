import type { Difficulty } from "../../shared/config";
import { Modal } from "./Modal";
import styles from "./CreateGame.module.css";

interface GuestGameProps {
  onStart: (playerCount: number, bots: Difficulty[]) => void;
  onCancel: () => void;
  starting: boolean;
  error: string | null;
}

/** What a guest's computer opponent plays at. */
const GUEST_LEVEL: Difficulty = "medium";

/**
 * Starting a game as a guest: the two games a guest can have.
 *
 * The full version asks how many players, which friends, and how hard the
 * machines should be. None of that means anything yet to somebody who has
 * been here ten seconds and has no account, no friends, and no idea whether
 * medium is the one they want -- so this asks the only question that is
 * really theirs to answer, and gets out of the way.
 */
export function GuestGame({ onStart, onCancel, starting, error }: GuestGameProps) {
  return (
    <Modal onDismiss={starting ? undefined : onCancel}>
      <div className={styles.body}>
        <h2 className={styles.title}>New game</h2>

        <div className={styles.choices}>
          <button
            type="button"
            className={styles.choice}
            disabled={starting}
            onClick={() => onStart(1, [])}
          >
            <strong>On your own</strong>
            <span className={styles.choiceHint}>
              Just you, against the board. Starts straight away.
            </span>
          </button>

          <button
            type="button"
            className={styles.choice}
            disabled={starting}
            onClick={() => onStart(2, [GUEST_LEVEL])}
          >
            <strong>Against the computer</strong>
            <span className={styles.choiceHint}>
              It plays a decent game and takes the squares you wanted.
            </span>
          </button>
        </div>

      {/*
        The way to a game with people in it, said where somebody is choosing
        one -- rather than left to be discovered by pressing something that
        turns out not to be there.
      */}
        <p className={styles.hint}>
          Playing with friends needs an account. Make one from the menu, any
          time.
        </p>

        {error !== null && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={onCancel}
            disabled={starting}
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
