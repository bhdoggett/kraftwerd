import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
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
  /**
   * Where focus goes once it closes, when that is not whatever had focus as it
   * opened. A menu item that opens a dialog also closes the menu, so by the
   * time the dialog looks, the item is gone and focus is on the page itself.
   */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** One open modal, as the keyboard sees it. */
interface Layer {
  panel: RefObject<HTMLDivElement | null>;
  dismiss: RefObject<(() => void) | undefined>;
}

/*
 * Every open modal, the most recent last.
 *
 * Keys are handled once, here, for whichever modal is on top. Each modal
 * listening for itself meant Escape in a dialog opened from another dialog
 * closed both, since every one of them heard it.
 */
const layers: Layer[] = [];

function onKey(e: KeyboardEvent) {
  const top = layers[layers.length - 1];
  if (top === undefined) return;

  if (e.key === "Escape") {
    const dismiss = top.dismiss.current;
    if (dismiss !== undefined) {
      e.preventDefault();
      dismiss();
    }
    return;
  }

  if (e.key === "Tab") trapTab(e, top.panel.current);
}

/*
 * Tab and Shift+Tab go round the panel and never out of it.
 *
 * Watched on the document rather than on the panel, because focus is not
 * always in the panel to be watched: a button that swaps the panel's contents
 * takes focus down with it, onto the page itself, and from there Tab would
 * walk straight into the page underneath.
 */
function trapTab(e: KeyboardEvent, el: HTMLDivElement | null) {
  if (el === null) return;
  const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const active = document.activeElement;

  if (items.length === 0) {
    e.preventDefault();
    el.focus();
    return;
  }

  const first = items[0];
  const last = items[items.length - 1];
  if (!(active instanceof Node) || !el.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && (active === first || active === el)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

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
export function Modal({ children, onDismiss, wide = false, label, returnFocusTo }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const headingId = useId();
  // Read at the moment of the key press, so a panel whose Escape changes
  // meaning (the word list goes back to the rules) is always up to date.
  const dismiss = useRef(onDismiss);
  useLayoutEffect(() => {
    dismiss.current = onDismiss;
  });

  // Named by its own heading, so no call site has to repeat its title. Every
  // render, not just the first: a panel that swaps its contents swaps its
  // heading too.
  useEffect(() => {
    const el = panel.current;
    if (el === null || label !== undefined) return;
    const heading = el.querySelector("h1, h2, h3");
    if (heading === null) {
      el.removeAttribute("aria-labelledby");
      return;
    }
    if (heading.id === "") heading.id = headingId;
    el.setAttribute("aria-labelledby", heading.id);
  });

  useEffect(() => {
    const el = panel.current;
    if (el === null) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const layer: Layer = { panel, dismiss };
    layers.push(layer);
    if (layers.length === 1) document.addEventListener("keydown", onKey);

    (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();

    return () => {
      layers.splice(layers.indexOf(layer), 1);
      if (layers.length === 0) document.removeEventListener("keydown", onKey);

      // Only while focus is still ours to hand back: a modal that closed
      // because it sent the reader somewhere else should not drag them back.
      // The return target is read now, on close, on purpose: it is whatever
      // that ref holds at the moment there is focus to hand back.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const back = returnFocusTo?.current ?? opener;
      const active = document.activeElement;
      if (back?.isConnected === true && (active === document.body || el.contains(active))) {
        back.focus();
      }
    };
    // Once, on open: re-running would pull focus back on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        className={[styles.panel, wide ? styles.wide : ""].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}
