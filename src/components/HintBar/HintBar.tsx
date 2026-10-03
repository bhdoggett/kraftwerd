import { useState } from "react";
import type { HintMove, HintResult } from "../../../shared/sim/coach";
import { blanksLabel, reasonsOf } from "../../lib/hintReasons";
import { Modal } from "../Modal/Modal";
import styles from "./HintBar.module.css";

interface HintBarProps {
  /** Your turn: the only time a hint is worth asking for. */
  canAsk: boolean;
  /** The game is still on; a finished one keeps the tag but not the buttons. */
  active?: boolean;
  /**
   * Which game and turn the bar is showing. A popover belongs to the turn it
   * was opened on, so one left open does not spring back on your next turn.
   */
  turnKey: string;
  result: HintResult | null;
  loading: boolean;
  error: string | null;
  onAsk: () => void;
  onPick: (move: HintMove) => void;
}

type Open = { kind: "hints" | "words"; key: string } | null;

/**
 * Hints in a practice game, above the board so they are in reach without
 * scrolling: a Practice tag and two buttons, each opening a popover. Both read
 * the same answer -- whichever is pressed first asks for it, and the other
 * opens at once. Picking a play stages it and closes the popover; Play is
 * still yours.
 */
export function HintBar({
  canAsk,
  active = true,
  turnKey,
  result,
  loading,
  error,
  onAsk,
  onPick,
}: HintBarProps) {
  const [open, setOpen] = useState<Open>(null);
  const showing = canAsk && open !== null && open.key === turnKey ? open.kind : null;

  const show = (kind: "hints" | "words") => {
    setOpen({ kind, key: turnKey });
    if (result === null && !loading) onAsk();
  };
  const close = () => setOpen(null);

  return (
    <div className={styles.bar} aria-label="Hints" role="group">
      <span className={styles.tag}>Practice</span>
      {active && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.ask}
            onClick={() => show("hints")}
            disabled={!canAsk}
          >
            {loading && showing === null ? "Thinking…" : "Hint"}
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => show("words")}
            disabled={!canAsk}
          >
            Words in your rack
          </button>
        </div>
      )}

      {showing !== null && (
        <Modal onDismiss={close}>
          <h2 className={styles.heading}>
            {showing === "hints" ? "Hints" : "Words in your rack"}
          </h2>

          {/* Waiting covers the moment between pressing and the request
              starting, not only the request itself. */}
          {result === null && error === null && <p className={styles.note}>Thinking…</p>}
          {error !== null && <p className={styles.error}>{error}</p>}

          {showing === "hints" && result !== null && (
            <>
              {result.moves.length === 0 && (
                <p className={styles.note}>No play found for this rack. A swap might help.</p>
              )}
              <div className={styles.cards}>
                {result.moves.map((move, i) => {
                  const reasons = reasonsOf(move);
                  return (
                    <button
                      key={i}
                      type="button"
                      className={styles.card}
                      onClick={() => {
                        onPick(move);
                        close();
                      }}
                    >
                      <span className={styles.points}>{move.total}</span>
                      <span className={styles.words}>
                        {move.words.map((w, j) => (
                          <span key={j} className={styles.word}>
                            {w.word}
                            {w.rare && <span className={styles.rare}>rare</span>}
                          </span>
                        ))}
                      </span>
                      <span className={styles.reasons}>
                        <span className={styles.blanks}>{blanksLabel(move)}</span>
                        {reasons.length > 0 && ` · ${reasons.join(" · ")}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {showing === "words" && result !== null && (
            <p className={styles.rackWords}>
              {result.rackWords.length > 0
                ? result.rackWords.join(", ")
                : "No words of three letters or more in this rack."}
            </p>
          )}

          <button type="button" className={styles.secondary} onClick={close}>
            Close
          </button>
        </Modal>
      )}
    </div>
  );
}
