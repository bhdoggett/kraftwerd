import { useState } from "react";
import { GAME } from "../../../shared/config";
import { Modal } from "../Modal/Modal";
import { SeatPicker } from "../SeatPicker/SeatPicker";
import styles from "../CreateGame/CreateGame.module.css";

interface PracticeDialogProps {
  onStart: (playerCount: number, seat: number) => void;
  onCancel: () => void;
  starting: boolean;
  error: string | null;
}

/* From two: a game of one has no robots to practice against. */
const COUNTS = Array.from({ length: GAME.maxPlayers - 1 }, (_, i) => i + 2);

/**
 * Practice: robots, hints on, nothing counted.
 *
 * New game asks who to play and how well each robot plays. Practice asks only
 * for a color and a table size, because the robots' strength is not the point.
 * Which robots they are and how they play is the caller's to decide.
 */
export function PracticeDialog({ onStart, onCancel, starting, error }: PracticeDialogProps) {
  const [count, setCount] = useState(2);
  const [seat, setSeat] = useState(0);

  return (
    <Modal onDismiss={starting ? undefined : onCancel}>
      <div className={styles.body}>
        <h2 className={styles.title}>Practice</h2>
        <p className={styles.hint}>Robots, with hints. Doesn’t count toward your record.</p>

        <div className={styles.field}>
          <span className={styles.label}>Your color</span>
          <SeatPicker totalSeats={GAME.maxPlayers} takenSeats={[]} value={seat} onChange={setSeat} />
        </div>

        <div className={styles.field} role="group" aria-labelledby="practiceCount">
          <span className={styles.label} id="practiceCount">
            Players
          </span>
          <div className={styles.counts}>
            {COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                className={[styles.count, n === count ? styles.countOn : ""].join(" ")}
                aria-pressed={n === count}
                aria-label={`${n} players`}
                onClick={() => setCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onCancel} disabled={starting}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => onStart(count, seat)}
            disabled={starting}
          >
            {starting ? "Starting…" : "Start"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
