import type { PointerEvent as ReactPointerEvent } from "react";
import { RecallIcon, ShuffleIcon, TradeIcon } from "./Icons";
import styles from "./Rack.module.css";

export type Selection = { kind: "letter"; index: number } | { kind: "blank" };

interface RackProps {
  /** The viewer's seat, which is what the tiles are lit in. */
  seat: number | null;
  letters: readonly string[];
  /** Letter indices staged on the board this turn, so out of the rack. */
  spent: readonly number[];
  /** Blanks still to spend, after any staged this turn. */
  blanks: number;
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
  seat,
  letters,
  spent,
  blanks,
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
  const tileProps = (sel: Selection) => ({
    "aria-pressed": isSelected(sel),
    onPointerDown: (e: ReactPointerEvent) => {
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
    <div className={styles.rack} data-rack="" data-seat={seat === null ? undefined : seat % 4}>
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
            const letter = letters[index];
            if (letter === undefined) return null;

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
                  isSelected({ kind: "letter", index }) ? styles.selected : "",
                  draggedIndex === index ? styles.lifted : "",
                  trading?.includes(index) ? styles.trading : "",
                ].join(" ")}
                // The letter's own index, not its position: staged tiles leave
                // the rack, so positions shift but indices do not.
                data-rack-slot={index}
                style={
                  shift === 0
                    ? undefined
                    : { transform: `translateX(calc(var(--rack-step) * ${shift}))` }
                }
                {...tileProps({ kind: "letter", index })}
              >
                {letter}
              </button>
            );
          })}
      </div>

      {/*
        One tile carrying a count, not a tile each: they are interchangeable,
        and three of them took up as much rack as three letters for no reason.
        The count is dropped at one, where a bare tile says the same thing.
      */}
      {blanks > 0 && (
        <div className={styles.blanks}>
          <button
            type="button"
            className={[
              styles.tile,
              styles.blank,
              isSelected({ kind: "blank" }) ? styles.selected : "",
            ].join(" ")}
            data-face="blank"
            aria-label={`Blank tile, ${blanks} left`}
            {...tileProps({ kind: "blank" })}
          >
            {blanks > 1 && <span className={styles.count}>{blanks}</span>}
          </button>
        </div>
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
          <RecallIcon />
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
          <TradeIcon />
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={onShuffle}
          aria-label="Shuffle your tiles"
          title="Shuffle"
        >
          <ShuffleIcon />
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
