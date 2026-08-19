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
  /**
   * Display order, as indices into `letters`. Owned by the parent because the
   * drag layer lives there and dropping one tile onto another reorders it.
   */
  order: readonly number[];
  /** Order to show right now — differs from `order` mid-drag. */
  previewOrder: readonly number[];
  /** Letter being dragged, rendered as a gap it has left behind. */
  draggedIndex: number | null;
  onShuffle: () => void;
  /** Take every staged tile back off the board. */
  onRecall: () => void;
  canRecall: boolean;
}

export function Rack({
  letters,
  blank,
  spent,
  blankSpent,
  selected,
  onSelect,
  onGrab,
  order,
  previewOrder,
  draggedIndex,
  onShuffle,
  onRecall,
  canRecall,
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
    <div className={styles.rack} data-rack="">
      <span className={styles.label}>Rack</span>

      {order
        // A tile being dragged back from the board is still staged, but it is
        // shown as a placeholder so the rack opens a gap for it instead of
        // letting the dragged tile land on top of a neighbour.
        .filter((index) => !spent.includes(index) || index === draggedIndex)
        .map((index, slot) => {
        const letter = letters[index];
        if (letter === undefined) return null;
        const sel: Selection = { kind: "letter", index };

        // DOM order stays put and tiles slide by transform instead, so the
        // movement animates; reordering the DOM would jump. Both orders are
        // compared with staged tiles removed, so the gaps line up.
        const shift =
          previewOrder.filter((i) => !spent.includes(i) || i === draggedIndex).indexOf(index) -
          slot;

        return (
          <button
            key={index}
            type="button"
            className={[
              styles.tile,
              isSelected(sel) ? styles.selected : "",
              draggedIndex === index ? styles.lifted : "",
            ].join(" ")}
            // The letter's real index, not its position: staged tiles leave
            // the rack, so positions shift but indices do not.
            data-rack-slot={index}
            style={
              shift === 0
                ? undefined
                : { transform: `translateX(calc(var(--rack-step) * ${shift}))` }
            }
            {...tileProps(sel, false)}
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
          aria-label="Blank tile"
        />
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          onClick={onRecall}
          disabled={!canRecall}
          aria-label="Take every tile back off the board"
          title="Recall tiles"
        >
          ↩
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={onShuffle}
          aria-label="Shuffle your tiles"
          title="Shuffle"
        >
          ⇄
        </button>
      </div>
    </div>
  );
}
