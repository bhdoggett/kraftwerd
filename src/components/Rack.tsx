import type { PointerEvent as ReactPointerEvent } from "react";
import styles from "./Rack.module.css";

export type Selection = { kind: "letter"; index: number } | { kind: "blank" };

interface RackProps {
  letters: readonly string[];
  blank: boolean;
  /** Indices of rack letters already staged on the board this turn. */
  spent: readonly number[];
  blankSpent: boolean;
  selected: Selection | null;
  onSelect: (selection: Selection | null) => void;
  /** Begin a pointer drag from this tile. */
  onGrab: (selection: Selection, event: ReactPointerEvent) => void;
}

export function Rack({
  letters,
  blank,
  spent,
  blankSpent,
  selected,
  onSelect,
  onGrab,
}: RackProps) {
  const isSelected = (s: Selection) =>
    selected !== null &&
    selected.kind === s.kind &&
    (s.kind !== "letter" || selected.kind !== "letter" || selected.index === s.index);

  /**
   * Pointer events drive both interactions: press selects, press-and-move
   * drags. HTML5 drag-and-drop is not usable here -- `draggable` on a form
   * control never fires `dragstart` in Firefox or Safari, and no drag event
   * fires on touch at all.
   *
   * Keyboard-triggered clicks arrive with `detail === 0` and no preceding
   * pointerdown, so they toggle selection on their own.
   */
  const tileProps = (sel: Selection, disabled: boolean) => ({
    disabled,
    "aria-pressed": isSelected(sel),
    onPointerDown: (e: ReactPointerEvent) => {
      if (disabled) return;
      onSelect(sel);
      onGrab(sel, e);
    },
    onClick: (e: { detail: number }) => {
      if (e.detail === 0) onSelect(isSelected(sel) ? null : sel);
    },
  });

  return (
    <div className={styles.rack}>
      <span className={styles.label}>Rack</span>

      {letters.map((letter, index) => {
        const used = spent.includes(index);
        const sel: Selection = { kind: "letter", index };
        return (
          <button
            key={index}
            type="button"
            className={[
              styles.tile,
              used ? styles.spent : "",
              isSelected(sel) ? styles.selected : "",
            ].join(" ")}
            {...tileProps(sel, used)}
          >
            {letter}
          </button>
        );
      })}

      {blank && (
        <button
          type="button"
          className={[
            styles.tile,
            styles.blank,
            blankSpent ? styles.spent : "",
            isSelected({ kind: "blank" }) ? styles.selected : "",
          ].join(" ")}
          {...tileProps({ kind: "blank" }, blankSpent)}
        >
          ?
        </button>
      )}
    </div>
  );
}
