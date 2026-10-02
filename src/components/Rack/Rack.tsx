import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PassIcon, RecallIcon, ShuffleIcon, TradeIcon } from "../Icons/Icons";
import { drawnFrom } from "../../lib/drawn";
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
  /**
   * The one free swap of the whole rack a game. It costs no turn, so it sits
   * beside Pass rather than replacing it.
   */
  onSwap: () => void;
  canSwap: boolean;
  swapping: boolean;
  onPass: () => void;
  canPass: boolean;
  passing: boolean;
  onPlay: () => void;
  canPlay: boolean;
  /**
   * Set when pressing the button is worth answering rather than ignoring --
   * it is somebody else's turn, and who it is waiting on is what the press is
   * asking. The button still reads as off; it just is not deaf.
   */
  playAnswers?: boolean;
  playing: boolean;
}

/** How long a shuffle's slide takes; matches `.shuffling` in Rack.module.css. */
const SHUFFLE_MS = 360;

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
  onSwap,
  canSwap,
  swapping,
  onPass,
  canPass,
  passing,
  onPlay,
  canPlay,
  playAnswers = false,
  playing,
}: RackProps) {
  /*
   * The tiles just drawn from the bag, which rise into the rack one after
   * another, left to right. Worked out while rendering, against the rack as it
   * last stood, so the first frame with the new letters already knows; `gen`
   * remounts those tiles, so a second draw into the same slots animates again.
   * Nothing on the first render: opening a game is not a draw.
   */
  const [seen, setSeen] = useState(letters);
  const [drawn, setDrawn] = useState<{ from: number; gen: number } | null>(null);
  if (letters !== seen && letters.join("") !== seen.join("")) {
    setSeen(letters);
    const from = drawnFrom(seen, letters);
    setDrawn(from < letters.length ? { from, gen: (drawn?.gen ?? 0) + 1 } : null);
  }
  const isDrawn = (index: number) => drawn !== null && index >= drawn.from;
  /** Left-to-right rank of each drawn tile, for its turn to rise. */
  const drawOrder = order.filter(isDrawn);

  /*
   * A new order with the same letters and nothing being dragged is a shuffle,
   * and gets a slower slide so the tiles are seen changing places. A drag
   * already moves each tile as it goes, so it keeps the quick one.
   */
  const [lastOrder, setLastOrder] = useState(order);
  const [shuffling, setShuffling] = useState(0);
  if (order !== lastOrder) {
    setLastOrder(order);
    if (draggedIndex === null && letters === seen && order.join() !== lastOrder.join()) {
      setShuffling((n) => n + 1);
    }
  }
  useEffect(() => {
    if (shuffling === 0) return;
    const done = setTimeout(() => setShuffling(0), SHUFFLE_MS);
    return () => clearTimeout(done);
  }, [shuffling]);

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
      onSelect(sel);
      onGrab(sel, e);
    },
    onClick: (e: { detail: number }) => {
      if (e.detail !== 0) return;
      onSelect(isSelected(sel) ? null : sel);
    },
  });

  return (
    // The frame is only there to be measured: the rack's layout answers to its
    // own width, and a container query cannot restyle the container itself.
    <div className={styles.frame}>
      <div className={styles.rack} data-rack="" data-seat={seat === null ? undefined : seat % 4}>
        <div className={[styles.tiles, shuffling > 0 ? styles.shuffling : ""].join(" ")}>
          {[...order]
            /*
             * The page keeps the tiles in one fixed order, by letter index, and
             * each is slid into its place by transform. Following the display
             * order instead moved the elements themselves on every shuffle, and a
             * moved element replays its animations -- so the tiles last drawn
             * rose out of the bag again.
             */
            .sort((a, b) => a - b)
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

              // Where the tile shows, against where the page has it.
              const shift =
                previewOrder
                  .filter((i) => !spent.includes(i) || (i === draggedIndex && dragOverRack))
                  .indexOf(index) - slot;

              const rising = isDrawn(index);
              return (
                <button
                  key={rising ? `${index}:${drawn!.gen}` : index}
                  type="button"
                  className={[
                    styles.tile,
                    isSelected({ kind: "letter", index }) ? styles.selected : "",
                    draggedIndex === index ? styles.lifted : "",
                    rising ? styles.drawn : "",
                  ].join(" ")}
                  // The letter's own index, not its position: staged tiles leave
                  // the rack, so positions shift but indices do not.
                  data-rack-slot={index}
                  style={{
                    ...(shift === 0
                      ? {}
                      : { transform: `translateX(calc(var(--rack-step) * ${shift}))` }),
                    ...(rising
                      ? ({ "--draw-order": drawOrder.indexOf(index) } as React.CSSProperties)
                      : {}),
                  }}
                  // Once risen, a tile stops being a fresh draw, so nothing later
                  // can set its rise off again.
                  onAnimationEnd={
                    rising && drawOrder.indexOf(index) === drawOrder.length - 1
                      ? () => setDrawn(null)
                      : undefined
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
            <span className={styles.actionLabel}>Recall</span>
          </button>
          <button
            type="button"
            onClick={onSwap}
            disabled={!canSwap}
            aria-pressed={swapping}
            className={[styles.action, swapping ? styles.actionOn : ""].join(" ")}
            aria-label="Swap your whole rack, once a game"
            title="Swap rack (once a game)"
          >
            <TradeIcon />
            <span className={styles.actionLabel}>Swap</span>
          </button>
          <button
            type="button"
            onClick={onPass}
            disabled={!canPass}
            aria-pressed={passing}
            className={[styles.action, passing ? styles.actionOn : ""].join(" ")}
            aria-label="Pass your turn"
            title="Pass"
          >
            <PassIcon />
            <span className={styles.actionLabel}>Pass</span>
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={onShuffle}
            aria-label="Shuffle your tiles"
            title="Shuffle"
          >
            <ShuffleIcon />
            <span className={styles.actionLabel}>Shuffle</span>
          </button>
          <button
            type="button"
            className={styles.play}
            onClick={onPlay}
            // Only truly disabled when there is nothing to say: a disabled
            // button fires no click, and so cannot answer the press.
            disabled={!canPlay && !playAnswers}
            aria-disabled={!canPlay}
          >
            {playing ? "Playing…" : "Play"}
          </button>
        </div>
      </div>
    </div>
  );
}
