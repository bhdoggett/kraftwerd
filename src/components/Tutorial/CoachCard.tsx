import { LONG_WORD_BONUS } from "../../../shared/config";
import type { TurnScore } from "../../../shared/engine/score";
import { squareBreakdown } from "../../lib/breakdown";
import type { Feedback } from "../../tutorial/model";
import styles from "./Tutorial.module.css";

interface CoachCardProps {
  step: number;
  total: number;
  heading: string;
  text: string;
  /** Shown after a move. */
  breakdown?: TurnScore;
  error?: boolean;
  /** Shows the Next button when given. */
  onNext?: () => void;
  onLeave: () => void;
}

function Breakdown({ score }: { score: TurnScore }) {
  const rows: { label: string; value: string }[] = [];
  for (const w of score.words) {
    rows.push(
      w.bonus === undefined
        ? { label: w.word, value: String(w.points) }
        : { label: `${w.word} ${w.points / w.bonus} ×${w.bonus}`, value: String(w.points) },
    );
    if (w.long) rows.push({ label: "Long word", value: `+${LONG_WORD_BONUS}` });
  }
  for (const sq of squareBreakdown(score.squares)) {
    rows.push({
      label: sq.count > 1 ? `${sq.count} × ${sq.size} square` : `${sq.size} square`,
      value: `+${sq.total}`,
    });
  }
  return (
    <div className={styles.breakdown}>
      {rows.map((r, i) => (
        <div key={i} className={styles.breakdownRow}>
          <span>{r.label}</span>
          <span>{r.value}</span>
        </div>
      ))}
      <div className={`${styles.breakdownRow} ${styles.breakdownTotal}`}>
        <span>Total</span>
        <span>{score.total}</span>
      </div>
    </div>
  );
}

export function CoachCard(p: CoachCardProps) {
  return (
    <section className={`${styles.coach} ${p.error ? styles.coachError : ""}`} aria-label="Coach">
      <div className={styles.coachHead}>
        <span className={styles.coachHeading}>{p.heading}</span>
        <span className={styles.coachStep}>
          {p.step} / {p.total}
        </span>
        <button type="button" className={styles.coachLeave} aria-label="Leave tutorial" onClick={p.onLeave}>
          ×
        </button>
      </div>
      <div aria-live="polite">
        <p className={styles.coachText}>{p.text}</p>
        {p.breakdown && <Breakdown score={p.breakdown} />}
      </div>
      {p.onNext && (
        <div className={styles.coachFoot}>
          <button type="button" className={styles.coachNext} onClick={p.onNext}>
            Next
          </button>
        </div>
      )}
    </section>
  );
}

// The copy lives beside the card that shows it.
// eslint-disable-next-line react-refresh/only-export-components
export function describeFeedback(f: Feedback): string {
  switch (f.kind) {
    case "offGhost": {
      const dx = f.target.x - f.x;
      const dy = f.target.y - f.y;
      let where = `marked ${f.letter}`;
      if (Math.abs(dx) + Math.abs(dy) === 1) {
        where = `one square ${dx === -1 ? "left" : dx === 1 ? "right" : dy === -1 ? "up" : "down"}`;
      }
      return `The ${f.letter} goes on the glowing square ${where}.`;
    }
    case "wrongLetter":
      return `That square wants ${f.wanted}, not ${f.placed}.`;
    case "missing":
      return `${f.count} more ${f.count === 1 ? "tile" : "tiles"} to place.`;
    case "ready":
      return "";
  }
}
