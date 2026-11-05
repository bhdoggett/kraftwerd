import type { FocusEvent, PointerEvent, Ref } from "react";
import styles from "./Game.module.css";

interface TurnCardProps {
  /** Who made the play. */
  name: string;
  /** Their seat, which colors the card. */
  seat: number | undefined;
  /** The words the spot being shown made; absent on the points step. */
  words?: readonly string[];
  /** What the play scored; shown once every spot is down. */
  points?: number;
  /** Something the player says about their move (the tutorial's opponents do, now and then). */
  quip?: string;
  /** Laid over the rack, which stays underneath, hidden. */
  overRack: boolean;
  onSkip: () => void;
  skipRef?: Ref<HTMLButtonElement>;
  onPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
  onFocus?: () => void;
  onBlur?: (e: FocusEvent<HTMLDivElement>) => void;
}

/**
 * Who just played, what it made and what it scored, in the rack's place while
 * somebody else's play is being shown, a spot at a time.
 */
export function TurnCard({ name, seat, words, points, quip, overRack, onSkip, skipRef, onPointerDown, onFocus, onBlur }: TurnCardProps) {
  return (
    <div
      // One element for the whole run of steps, not one per step: it
      // stays up from one play to the next and changes color between
      // players, rather than vanishing and fading back in each time.
      className={[styles.announce, overRack ? styles.announceOverRack : ""].join(" ")}
      data-seat={seat}
      // No role="status": the announcer says the play once, whole,
      // rather than this card spot by spot.
      onPointerDown={onPointerDown}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <button
        ref={skipRef}
        type="button"
        className={styles.announceClose}
        aria-label="Skip the replay"
        title="Skip"
        // Its own press, not the card's, which only cuts a catch-up short.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onSkip}
      >
        ×
      </button>
      <span className={styles.announceName}>{name}</span>
      {words !== undefined && words.length > 0 && <span className={styles.recapWords}>{words.join(", ")}</span>}
      {/* The points are their own last step, once every spot is down. */}
      {points !== undefined && <span className={styles.recapPoints}>+{points}</span>}
      {quip !== undefined && <span className={styles.recapQuip}>“{quip}”</span>}
    </div>
  );
}
