import type { PointerEvent as ReactPointerEvent } from "react";
import styles from "./Rack.module.css";

export type Selection = { kind: "letter"; index: number } | { kind: "blank" };

/** Stands for the blank in the rack order, alongside the letters' indices. */
const BLANK = -1;

interface RackProps {
  letters: readonly string[];
  /** Rack entries already staged on the board this turn, blank included. */
  spent: readonly number[];
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
  /** Whether the pointer is over the rack, so a gap should be made for it. */
  dragOverRack: boolean;
  onShuffle: () => void;
  /** Take every staged tile back off the board. */
  onRecall: () => void;
  canRecall: boolean;
  /** Tiles picked for trading; null when not trading. */
  trading: readonly number[] | null;
  onToggleTrade: (index: number) => void;
  onStartTrade: () => void;
  canTrade: boolean;
  onPlay: () => void;
  canPlay: boolean;
  playing: boolean;
}

export function Rack({
  letters,
  spent,
  selected,
  onSelect,
  onGrab,
  order,
  previewOrder,
  draggedIndex,
  dragOverRack,
  onShuffle,
  onRecall,
  canRecall,
  trading,
  onToggleTrade,
  onStartTrade,
  canTrade,
  onPlay,
  canPlay,
  playing,
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
      // While trading, a tile is a choice rather than something to play.
      if (trading !== null) {
        if (sel.kind === "letter") onToggleTrade(sel.index);
        return;
      }
      onSelect(sel);
      onGrab(sel, e);
    },
    onClick: (e: { detail: number }) => {
      if (e.detail !== 0) return;
      if (trading !== null) {
        if (sel.kind === "letter") onToggleTrade(sel.index);
        return;
      }
      onSelect(isSelected(sel) ? null : sel);
    },
  });

  return (
    <div className={styles.rack} data-rack="">
      <div className={styles.tiles}>
        {order
          // A staged tile leaves the rack. One being dragged back appears as a
          // placeholder once the pointer is over the rack, so the gap opens
          // where it is heading rather than sitting empty where it came from.
          .filter(
            (index) =>
              !spent.includes(index) || (index === draggedIndex && dragOverRack),
          )
          .map((index, slot) => {
            const isBlank = index === BLANK;
            const letter = isBlank ? "" : letters[index];
            if (letter === undefined) return null;

            const sel: Selection = isBlank
              ? { kind: "blank" }
              : { kind: "letter", index };

            // DOM order stays put and tiles slide by transform instead, so the
            // movement animates; reordering the DOM would jump.
            const shift =
              previewOrder
                .filter((i) => !spent.includes(i) || (i === draggedIndex && dragOverRack))
                .indexOf(index) - slot;

            return (
              <button
                key={index}
                type="button"
                className={[
                  styles.tile,
                  isBlank ? styles.blank : "",
                  isSelected(sel) ? styles.selected : "",
                  draggedIndex === index ? styles.lifted : "",
                  trading?.includes(index) ? styles.trading : "",
                ].join(" ")}
                // The entry's own identity, not its position: staged tiles
                // leave the rack, so positions shift but identities do not.
                data-rack-slot={index}
                style={
                  shift === 0
                    ? undefined
                    : { transform: `translateX(calc(var(--rack-step) * ${shift}))` }
                }
                aria-label={isBlank ? "Blank tile" : undefined}
                {...tileProps(sel, false)}
              >
                {letter}
              </button>
            );
          })}
      </div>

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
          onClick={onStartTrade}
          disabled={!canTrade}
          aria-pressed={trading !== null}
          className={[styles.action, trading !== null ? styles.actionOn : ""].join(" ")}
          aria-label="Trade tiles in for new ones"
          title="Trade tiles"
        >
          ⇅
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
        <button
          type="button"
          className={styles.play}
          onClick={onPlay}
          disabled={!canPlay}
        >
          {playing ? "Playing…" : "Play"}
        </button>
      </div>
    </div>
  );
}
