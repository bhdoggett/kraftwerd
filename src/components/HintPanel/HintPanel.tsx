import type { HintMove, HintResult } from "../../../shared/sim/coach";
import { reasonsOf } from "../../lib/hintReasons";
import styles from "./HintPanel.module.css";

interface HintPanelProps {
  /** Your turn: the only time a hint is worth asking for. */
  canAsk: boolean;
  /** The game is still on; a finished one keeps the tag but not the button. */
  active?: boolean;
  result: HintResult | null;
  loading: boolean;
  error: string | null;
  onAsk: () => void;
  onPick: (move: HintMove) => void;
}

/**
 * Hints in a practice game: a button, up to three plays to pick from, and the
 * words the rack spells. Picking a play stages it; Play is still yours.
 */
export function HintPanel({ canAsk, active = true, result, loading, error, onAsk, onPick }: HintPanelProps) {
  return (
    <section className={styles.panel} aria-label="Hints">
      <div className={styles.header}>
        <span className={styles.tag}>Practice</span>
        {active && (
          <button
            type="button"
            className={styles.ask}
            onClick={onAsk}
            disabled={!canAsk || loading}
          >
            {loading ? "Thinking…" : "Hint"}
          </button>
        )}
      </div>

      {error !== null && <p className={styles.error}>{error}</p>}

      {result !== null && result.moves.length === 0 && (
        <p className={styles.empty}>No play found for this rack. A swap might help.</p>
      )}

      {result?.moves.map((move, i) => {
        const reasons = reasonsOf(move);
        return (
          <button key={i} type="button" className={styles.card} onClick={() => onPick(move)}>
            <span className={styles.points}>{move.total}</span>
            <span className={styles.words}>
              {move.words.map((w, j) => (
                <span key={j} className={styles.word}>
                  {w.word}
                  {w.rare && <span className={styles.rare}>rare</span>}
                </span>
              ))}
            </span>
            {reasons.length > 0 && <span className={styles.reasons}>{reasons.join(" · ")}</span>}
          </button>
        );
      })}

      {result !== null && result.rackWords.length > 0 && (
        <details className={styles.rackWords}>
          <summary>Words in your rack</summary>
          <p>{result.rackWords.join(", ")}</p>
        </details>
      )}
    </section>
  );
}
