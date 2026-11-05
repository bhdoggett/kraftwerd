import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import { cellKey, type Board } from "../../../shared/engine/board";
import type { Placement } from "../../../shared/engine/score";
import { STACK_CAP } from "../../../shared/config";
import type { Selection } from "../Rack/Rack";
import { moveToPosition, rackSlotUnder, shuffled } from "../../lib/rackGeometry";
import { moveStagedTo, stageAt } from "../../lib/staging";
import { followPointer } from "../../lib/followPointer";

/** A staged placement, plus which rack slot it came from. */
export interface Staged extends Placement {
  from: Selection;
}

/** Where a drag started: the rack, or a tile already staged on the board. */
export type Origin = { kind: "rack"; selection: Selection } | { kind: "cell"; x: number; y: number };

/** Live pointer drag: the tile that follows the finger/cursor. */
export interface Drag {
  letter: string;
  isBlank: boolean;
  x: number;
  y: number;
  origin: Origin;
}

export interface TileStagingOptions {
  /** The rack. */
  letters: readonly string[];
  /** Blanks in hand. */
  blanks: number;
  /** The board before this turn, for `changesNothing` and `isFull`. */
  before: Board | null;
  /** Whether there is a rack to play from at all. */
  canPlace: boolean;
  /** A blank landed at (x, y). Return a letter to stage it now, or null to ask (game screen). */
  nameBlank: (x: number, y: number) => string | null;
  refuse: (why: string) => void;
  /** Called wherever staging changes, so a stale error can be taken down. */
  clearError?: () => void;
}

/**
 * Whether a letter would land on the same letter, changing nothing.
 *
 * The rules refuse such a play, so there is no point letting it be staged
 * and explaining afterwards: the tile simply does not land, and goes back
 * where it came from.
 */
export function changesNothing(before: Board | null, x: number, y: number, letter: string) {
  return before?.get(cellKey(x, y))?.letter === letter.toUpperCase();
}

/**
 * Whether a square has taken all the tiles it ever will.
 *
 * The rules refuse a play there, so the tile does not land: it goes back
 * where it came from rather than sitting on the board waiting to be told
 * on Play.
 */
export function isFull(before: Board | null, x: number, y: number) {
  return (before?.get(cellKey(x, y))?.stacked ?? 0) >= STACK_CAP;
}

export interface TileStaging {
  pending: Staged[];
  setPending: Dispatch<SetStateAction<Staged[]>>;
  selected: Selection | null;
  setSelected: (s: Selection | null) => void;
  blankAt: { x: number; y: number } | null;
  setBlankAt: (c: { x: number; y: number } | null) => void;
  rackOrder: number[];
  previewOrder: number[];
  spentIndices: number[];
  blanksLeft: number;
  draggedLetterIndex: number | null;
  dragOverRack: boolean;
  drag: Drag | null;
  place: (x: number, y: number) => void;
  pickUp: (x: number, y: number) => void;
  grab: (s: Selection, e: ReactPointerEvent) => void;
  grabStaged: (x: number, y: number, e: ReactPointerEvent) => void;
  shuffle: () => void;
  recallAll: () => void;
}

/**
 * Tiles staged this turn, the rack's order and selection, and the pointer
 * drag that moves tiles between them -- everything a screen needs to lay out a
 * play, without the game behind it. The game screen and the tutorial share
 * it, so a drag there is the drag here.
 */
export function useTileStaging(o: TileStagingOptions): TileStaging {
  const { letters, blanks, before, canPlace } = o;

  const [pending, setPending] = useState<Staged[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);
  /**
   * A blank has been dropped on this square and is waiting to be told what
   * letter it stands for. Asking on release rather than beforehand means the
   * blank drags like any other tile.
   */
  const [blankAt, setBlankAt] = useState<{ x: number; y: number } | null>(null);

  /**
   * Rack display order, as indices into the dealt letters, with BLANK for the
   * blank so it can be moved like anything else. Purely cosmetic:
   * selections and staged tiles always travel by real index, so reordering can
   * never change which tile a placement came from.
   */
  const [rackOrder, setRackOrder] = useState<number[]>([]);
  /** Letter index the pointer is over while dragging a rack tile. */
  const [rackHover, setRackHover] = useState<number | null>(null);

  /** Live pointer drag: the tile that follows the finger/cursor. */
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<{ moved: boolean } | null>(null);

  const clearError = () => o.clearError?.();

  const rackSignature = letters.join(",");
  // A new rack starts in dealt order. Reset while rendering, not in an
  // effect, so the old order is never drawn against the new letters.
  const [orderedRack, setOrderedRack] = useState<string | null>(null);
  if (orderedRack !== rackSignature) {
    setOrderedRack(rackSignature);
    const count = rackSignature === "" ? 0 : rackSignature.split(",").length;
    setRackOrder(Array.from({ length: count }, (_, i) => i));
  }

  /** Letters currently staged on the board, so hidden from the rack. */
  const spentIndices = useMemo(
    () =>
      pending
        .filter((p) => p.from.kind === "letter")
        .map((p) => (p.from as { kind: "letter"; index: number }).index),
    [pending],
  );

  function shuffleRack() {
    setRackOrder(shuffled);
  }

  /** Drop a dragged rack tile into a position, sliding the rest along. */
  function reorderRack(fromIndex: number, position: number | null) {
    if (position === null) return;
    setRackOrder((current) => moveToPosition(current, spentIndices, fromIndex, position));
  }

  /**
   * Drag a staged tile off the board and back into the rack, landing where it
   * was dropped. The letter never left `rackOrder` — staged tiles are only
   * hidden from the rack — so this unstages it and moves it into position.
   */
  function recallToRack(from: { x: number; y: number }, position: number | null) {
    const tile = pending.find((p) => p.x === from.x && p.y === from.y);
    if (tile === undefined) return;

    setPending((current) => current.filter((p) => p !== tile));
    clearError();

    if (position !== null && tile.from.kind === "letter") {
      const index = tile.from.index;
      // The tile is no longer staged, so it is visible again for the move.
      const stillHidden = spentIndices.filter((i) => i !== index);
      setRackOrder((current) => moveToPosition(current, stillHidden, index, position));
    }
  }

  /** Blanks still in hand: the allowance less any staged or being named. */
  const blanksLeft = Math.max(
    0,
    blanks -
      pending.filter((p) => p.from.kind === "blank").length -
      (blankAt === null ? 0 : 1),
  );

  /**
   * The rack letter a drag concerns, whether it started in the rack or is a
   * staged tile heading back. Blanks have no rack slot to move.
   */
  const draggedLetterIndex = useMemo(() => {
    if (drag === undefined || drag === null) return null;
    if (drag.origin.kind === "rack") {
      return drag.origin.selection.kind === "letter"
        ? drag.origin.selection.index
        : null;
    }
    const cell = drag.origin;
    const staged = pending.find((p) => p.x === cell.x && p.y === cell.y);
    if (staged === undefined || staged.from.kind !== "letter") return null;
    return staged.from.index;
  }, [drag, pending]);

  /**
   * Order to render right now. While a rack tile is over another slot this is
   * the order it *would* become, so the gap follows the pointer instead of
   * appearing only on release.
   */
  const previewOrder = useMemo(() => {
    if (draggedLetterIndex === null || rackHover === null) return rackOrder;
    const dragged = draggedLetterIndex;

    const stillHidden = spentIndices.filter((i) => i !== dragged);
    return moveToPosition(rackOrder, stillHidden, dragged, rackHover);
  }, [draggedLetterIndex, rackHover, rackOrder, spentIndices]);

  // Kept in a ref so the pointer listeners below can call the current
  // `place` without re-subscribing on every mouse move. Refreshed after each
  // commit rather than while rendering, which is before any pointer event
  // can reach them.
  const reorderRef = useRef<(fromIndex: number, over: number | null) => void>(() => {});
  const recallRef = useRef<(from: { x: number; y: number }, over: number | null) => void>(
    () => {},
  );
  const dropRef = useRef<(x: number, y: number, origin: Origin) => void>(() => {});
  useLayoutEffect(() => {
    reorderRef.current = reorderRack;
    recallRef.current = recallToRack;
    dropRef.current = (x, y, origin) => {
      if (origin.kind !== "cell") place(x, y);
      // A staged tile that cannot land on the square it was dropped on goes
      // home to the rack, not back to the square it left.
      else if (!moveStaged(origin, x, y)) recallRef.current(origin, null);
    };
  });

  // Window-level so the drag survives leaving the rack, and so releasing
  // anywhere ends it.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      if (dragRef.current) dragRef.current.moved = true;
      setDrag((d) => (d === null ? null : { ...d, x: e.clientX, y: e.clientY }));

      setRackHover(rackSlotUnder(e.clientX, e.clientY).position);
    };

    const onUp = (e: PointerEvent) => {
      const moved = dragRef.current?.moved ?? false;
      const origin = drag?.origin;
      dragRef.current = null;
      setDrag(null);
      setRackHover(null);

      // A press without movement is a selection, not a drag: leave the tile
      // selected so tap-then-tap still works.
      if (!moved) return;

      // Dropped onto the rack. Same geometry as the preview, so releasing
      // lands where the gap was shown.
      const over = rackSlotUnder(e.clientX, e.clientY);
      if (over.overRack) {
        if (origin === undefined) return;
        if (origin.kind === "cell") recallRef.current(origin, over.position);
        else if (origin.selection.kind === "letter") {
          reorderRef.current(origin.selection.index, over.position);
        }
        return;
      }

      const cell = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest("[data-cell]")
        ?.getAttribute("data-cell");
      if (!cell) {
        // Dropped somewhere no tile can go -- the margin round the board, a
        // blocked square, the page itself. A staged tile goes to the rack
        // rather than back to its square: letting go of it there reads as
        // putting it down, not as wanting it where it was.
        if (origin?.kind === "cell") recallRef.current(origin, null);
        return;
      }

      const [cx, cy] = cell.split(",").map(Number);
      if (cx !== undefined && cy !== undefined && origin !== undefined) {
        dropRef.current(cx, cy, origin);
      }
    };

    return followPointer(onMove, onUp);
  }, [dragging, drag?.origin]);

  /**
   * Pointer-based dragging, deliberately not HTML5 drag-and-drop: `draggable`
   * on a form control never fires `dragstart` in Firefox or Safari, and drag
   * events do not exist on touch at all. Pointer events behave identically for
   * mouse, trackpad and finger.
   */
  function startDrag(
    letter: string,
    isBlank: boolean,
    origin: Origin,
    event: ReactPointerEvent,
  ) {
    dragRef.current = { moved: false };
    setDrag({ letter, isBlank, x: event.clientX, y: event.clientY, origin });
  }

  /** Drag a tile out of the rack. The blank drags blank; it is asked about
   * only once it lands somewhere. */
  function grab(selection: Selection, event: ReactPointerEvent) {
    // Not gated on whose turn it is: sorting your own rack is thinking, and
    // thinking is most of what you do while you wait. Dropping one on the
    // board is what needs the turn, and `place` still asks for it -- off your
    // turn a tile dragged onto a square simply goes back where it came from.
    if (!canPlace) return;
    // The blank has to be answered before anything else can be moved.
    if (blankAt !== null) return;

    if (selection.kind === "blank") {
      startDrag("", true, { kind: "rack", selection }, event);
      return;
    }

    const letter = letters[selection.index];
    if (letter === undefined) return;

    startDrag(letter, false, { kind: "rack", selection }, event);
  }

  /** Drag a tile already staged this turn to a different square. */
  function grabStaged(x: number, y: number, event: ReactPointerEvent) {
    const tile = pending.find((p) => p.x === x && p.y === y);
    if (tile === undefined) return;
    startDrag(tile.letter, tile.isBlank, { kind: "cell", x, y }, event);
  }

  /**
   * Move a staged tile, keeping the rack slot it came from. False when the
   * square refuses it, so the caller can send it to the rack instead.
   */
  function moveStaged(origin: { x: number; y: number }, x: number, y: number): boolean {
    const moving = pending.find((p) => p.x === origin.x && p.y === origin.y);
    if (moving !== undefined) {
      // Landing it there would change nothing, so it stays where it was.
      if (changesNothing(before, x, y, moving.letter)) {
        o.refuse(`That square is already ${moving.letter} — a tile has to change it.`);
        return false;
      }
      if (isFull(before, x, y)) {
        o.refuse(`That square is full — ${STACK_CAP} tiles is the limit.`);
        return false;
      }
    }

    setPending((current) => moveStagedTo(current, origin, x, y));
    clearError();
    return true;
  }

  function place(x: number, y: number) {
    if (selected === null || !canPlace) return;

    if (selected.kind === "blank") {
      // A full square takes nothing: no point asking what the blank stands
      // for when it cannot land.
      if (isFull(before, x, y)) {
        o.refuse(`That square is full — ${STACK_CAP} tiles is the limit.`);
        setSelected(null);
        return;
      }
      const named = o.nameBlank(x, y);
      if (named === null) {
        // Landed, but nameless: ask now.
        setBlankAt({ x, y });
        setSelected(null);
        clearError();
        return;
      }
      // Named by the screen itself: the same check the asked-for letter gets.
      if (changesNothing(before, x, y, named)) {
        o.refuse(`That square is already ${named} — a tile has to change it.`);
        setSelected(null);
        return;
      }
      setPending((p) =>
        stageAt(p, { x, y, letter: named, isBlank: true, from: { kind: "blank" } }),
      );
    } else {
      const letter = letters[selected.index];
      if (letter === undefined) return;
      if (changesNothing(before, x, y, letter)) {
        o.refuse(`That square is already ${letter} — a tile has to change it.`);
        setSelected(null);
        return;
      }
      if (isFull(before, x, y)) {
        o.refuse(`That square is full — ${STACK_CAP} tiles is the limit.`);
        setSelected(null);
        return;
      }
      setPending((p) => stageAt(p, { x, y, letter, isBlank: false, from: selected }));
    }

    setSelected(null);
    clearError();
  }

  function pickUp(x: number, y: number) {
    const tile = pending.find((p) => p.x === x && p.y === y);
    setPending((p) => p.filter((s) => !(s.x === x && s.y === y)));
    clearError();

    // A blank's letter is a decision, so tapping it reopens that decision
    // rather than throwing the tile back to the rack. A screen that names its
    // own blanks has no decision to reopen, so there the blank simply goes home.
    if (tile?.isBlank === true && o.nameBlank(x, y) === null) setBlankAt({ x, y });
  }

  /** Everything staged goes back to the rack, and nothing is left half-chosen. */
  function recallAll() {
    setPending([]);
    setSelected(null);
    setBlankAt(null);
    clearError();
  }

  return {
    pending,
    setPending,
    selected,
    setSelected,
    blankAt,
    setBlankAt,
    rackOrder,
    previewOrder,
    spentIndices,
    blanksLeft,
    draggedLetterIndex,
    dragOverRack: rackHover !== null,
    drag,
    place,
    pickUp,
    grab,
    grabStaged,
    shuffle: shuffleRack,
    recallAll,
  };
}
