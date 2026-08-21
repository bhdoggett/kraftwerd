import { useEffect, type ReactNode } from "react";
import styles from "./Modal.module.css";

interface ModalProps {
  children: ReactNode;
  /**
   * Close on a press outside, or on Escape. Leave it off for a modal that
   * should only go away through one of its own buttons.
   */
  onDismiss?: () => void;
  /** For a panel of prose, rather than a short question. */
  wide?: boolean;
}

/**
 * A centred panel over a dimmed page.
 *
 * The chrome was written out three times — the rules, a new game, and starting
 * one with a friend — which is how they drifted apart on width, layering, and
 * whether Escape did anything.
 */
export function Modal({ children, onDismiss, wide = false }: ModalProps) {
  useEffect(() => {
    if (onDismiss === undefined) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      // Only a press that lands on the backdrop itself: one that started
      // inside the panel and drifted out is a slip, not a dismissal.
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss?.();
      }}
    >
      <div className={[styles.panel, wide ? styles.wide : ""].join(" ")}>{children}</div>
    </div>
  );
}
