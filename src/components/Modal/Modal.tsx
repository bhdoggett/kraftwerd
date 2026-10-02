import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
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
  /**
   * What a screen reader announces the dialog as. Only needed when the panel
   * has no heading of its own: otherwise its first heading names it.
   */
  label?: string;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A centred panel over a dimmed page.
 *
 * The chrome was written out three times — the rules, a new game, and starting
 * one with a friend — which is how they drifted apart on width, layering, and
 * whether Escape did anything.
 *
 * Focus moves into the panel when it opens, stays there while Tab cycles, and
 * goes back to whatever opened it when it closes — otherwise a keyboard user
 * is left tabbing through the page underneath.
 */
export function Modal({ children, onDismiss, wide = false, label }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const headingId = useId();

  useEffect(() => {
    if (onDismiss === undefined) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  useEffect(() => {
    const el = panel.current;
    if (el === null) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Named by its own heading, so no call site has to repeat its title.
    if (label === undefined) {
      const heading = el.querySelector("h1, h2, h3");
      if (heading !== null) {
        if (heading.id === "") heading.id = headingId;
        el.setAttribute("aria-labelledby", heading.id);
      }
    }

    (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();

    return () => {
      // Only while focus is still ours to hand back: a modal that closed
      // because it sent the reader somewhere else should not drag them back.
      const active = document.activeElement;
      if (opener?.isConnected === true && (active === document.body || el.contains(active))) {
        opener.focus();
      }
    };
    // Once, on open: re-running would pull focus back on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== "Tab" || panel.current === null) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={styles.backdrop}
      // Only a press that lands on the backdrop itself: one that started
      // inside the panel and drifted out is a slip, not a dismissal.
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss?.();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={[styles.panel, wide ? styles.wide : ""].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}
