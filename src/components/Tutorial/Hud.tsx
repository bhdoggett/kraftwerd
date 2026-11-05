import styles from "./Tutorial.module.css";

interface HudProps {
  /** The player's moves made so far, and in all. */
  done: number;
  total: number;
  sound: boolean;
  onSound: () => void;
  /** From the player's third move: lays every tile of the move on its ghost. */
  onAutoPlace?: () => void;
}

/**
 * Under the board, at the left end of the zoom buttons' row, so it never
 * covers a square: how far through the tutorial the player is (a dot a move of
 * theirs), and the switch for its sound effects (a click as a tile lands, a
 * chime when a move scores) and a phone's buzz. From the player's third
 * move, a button to lay the move's tiles for them.
 */
export function Hud({ done, total, sound, onSound, onAutoPlace }: HudProps) {
  return (
    <div className={styles.hud}>
      <span className={styles.dots} role="img" aria-label={`Tutorial progress: ${done} of ${total} moves played`}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={styles.dot} data-done={i < done ? "" : undefined} />
        ))}
      </span>
      <button
        type="button"
        className={styles.soundButton}
        aria-pressed={sound}
        aria-label={sound ? "Sound and buzz on" : "Sound and buzz off"}
        title="Sound effects"
        data-own-action=""
        onClick={onSound}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 9v6h4l5 4V5L8 9Z" />
          {sound ? <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" /> : <path d="m16 9 6 6m0-6-6 6" />}
        </svg>
      </button>
      {onAutoPlace !== undefined && (
        <button type="button" className={styles.autoPlace} data-own-action="" onClick={onAutoPlace}>
          Place tiles for me
        </button>
      )}
    </div>
  );
}
