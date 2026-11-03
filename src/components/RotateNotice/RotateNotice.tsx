import styles from "./RotateNotice.module.css";

/**
 * Asks for the phone to be turned upright, over everything else, while it is
 * held sideways.
 *
 * Phones play upright only. The apps are locked to portrait, but a browser
 * cannot be, so the website says so instead of laying the game out sideways.
 * Always in the page and shown by CSS alone: whether a phone is sideways is a
 * media query, and it changes without React having to hear about it.
 */
export function RotateNotice() {
  return (
    <div className={styles.notice}>
      <p className={styles.message}>Turn your phone upright to play.</p>
    </div>
  );
}
