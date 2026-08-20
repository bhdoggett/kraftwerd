import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { makeBoard } from "../../shared/engine/board";
import { makeDictionary } from "../../shared/engine/dictionary";
import { applyPlacements, validateTurn, wordsFormed } from "../../shared/engine/legality";
import { runsThrough } from "../../shared/engine/runs";
import { layoutByName, shapeOf } from "../../shared/boards";
import { scoreTurn, type Placement, type TurnScore } from "../../shared/engine/score";
import { Board } from "./Board";
import { DevTools } from "./DevTools";
import styles from "./Game.module.css";
import { Rack, type Selection } from "./Rack";
import { userMessage } from "../lib/errors";
import { useWakeLock } from "../lib/useWakeLock";
import { Scoreboard } from "./Scoreboard";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * The score split by what earned it: the tiles themselves, then each size of
 * square. Every tile is a 1×1 worth 1, and a k×k is worth k², so the whole
 * scoring rule is legible from the table.
 */
/** Squares only: the words carry their own points beside each word. */
function breakdownOf(score: TurnScore) {
  const bySize = new Map<number, number>();
  for (const size of score.squares) bySize.set(size, (bySize.get(size) ?? 0) + 1);

  return [...bySize.keys()]
    .sort((a, b) => a - b)
    .map((size) => ({
      size: `${size}×${size}`,
      count: bySize.get(size)!,
      total: bySize.get(size)! * size * size,
    }));
}

/** Why a staged play is not yet legal, in words a player can act on. */
function describeLegality(
  legality: Exclude<ReturnType<typeof validateTurn>, { ok: true }>,
): string {
  switch (legality.reason) {
    case "empty-turn":
      return "Place at least one tile.";
    case "out-of-bounds":
      return "That square is off the board.";
    case "occupied":
      return "There is already a tile there.";
    case "duplicate-cell":
      return "Two tiles on the same square.";
    case "blocked":
      return "That square cannot be played on.";
    case "missing-centre":
      return "The first word has to cover the centre square.";
    case "disconnected":
      return "Every tile must connect to the tiles already on the board.";
    case "invalid-words":
      return legality.words.length === 1
        ? `${legality.words[0]} is not a word.`
        : `Not words: ${legality.words.join(", ")}.`;
  }
}

/** A staged placement, plus which rack slot it came from. */
interface Staged extends Placement {
  from: Selection;
}

/**
 * Which rack tile the pointer is over, by the tile's real letter index.
 *
 * Deliberately geometric rather than `elementFromPoint`: tiles slide by
 * transform during a drag, so hit-testing would see them in their shifted
 * positions, reorder, shift them again, and oscillate. `offsetLeft` is layout
 * position and does not move while only transforms change, so the answer is
 * stable. A tile also has to be crossed past its middle before it counts,
 * which stops a tremble on the boundary from flapping the order.
 */
function rackSlotUnder(
  clientX: number,
  clientY: number,
): { overRack: boolean; position: number | null } {
  const miss = { overRack: false, position: null };
  const rack = document.querySelector("[data-rack]");
  if (!(rack instanceof HTMLElement)) return miss;

  const tiles = [...rack.querySelectorAll("[data-rack-slot]")].filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );

  const bounds = rack.getBoundingClientRect();
  const insideRack =
    clientY >= bounds.top &&
    clientY <= bounds.bottom &&
    clientX >= bounds.left &&
    clientX <= bounds.right;

  // Every tile is out on the board, so there is nothing to measure against and
  // nothing that could be disturbed: the whole rack takes the tile back.
  if (tiles.length === 0) {
    return insideRack ? { overRack: true, position: 0 } : miss;
  }

  // Has to be over the rack at all: outside it the pointer is on the board,
  // and nothing in the rack should stir.
  if (!insideRack) return miss;

  // The tiles are centred, so there is empty rack either side of them. Both
  // sides are drop targets: left of the tiles means the start, right of them
  // means the end.
  const first = tiles[0]!.getBoundingClientRect();
  if (clientX < first.left) return { overRack: true, position: 0 };

  const localX = clientX - bounds.left + rack.scrollLeft;

  // Position, not identity. The tiles are visually shifted by the preview
  // while their layout boxes stay put, so asking "which letter is under the
  // pointer" gives an answer that disagrees with what the player sees — that
  // mismatch is what made a drag skip past letters. Asking "which slot is the
  // pointer in" is the same question in both frames.
  for (const [position, el] of tiles.entries()) {
    if (localX < el.offsetLeft + el.offsetWidth) return { overRack: true, position };
  }
  // Past every tile: append.
  return { overRack: true, position: tiles.length };
}

/**
 * Placed squares that do not reach the rest of the board.
 *
 * Floods orthogonally from a tile that was already on the board — or from the
 * first placement when the board was empty — and reports whichever placements
 * the flood never reached.
 */
function disconnectedCells(
  board: ReturnType<typeof makeBoard>,
  placements: readonly Placement[],
): Set<string> {
  const orphans = new Set<string>();
  const placedKeys = new Set(placements.map((p) => `${p.x},${p.y}`));

  const existing = [...board.keys()].find((key) => !placedKeys.has(key));
  const first = placements[0];
  const start = existing ?? (first ? `${first.x},${first.y}` : undefined);
  if (start === undefined) return orphans;

  const seen = new Set([start]);
  const queue = [start];

  while (queue.length > 0) {
    const [x, y] = queue.pop()!.split(",").map(Number);
    for (const [dx, dy] of NEIGHBOURS) {
      const key = `${x! + dx},${y! + dy}`;
      if (!board.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push(key);
    }
  }

  for (const key of placedKeys) if (!seen.has(key)) orphans.add(key);
  return orphans;
}

/**
 * Move `value` to `position` among the tiles on show, keeping staged tiles
 * (which are hidden) after them. Positions are what the player is aiming at;
 * doing this in terms of the full order would count hidden tiles the player
 * cannot see.
 */
function moveToPosition(
  order: readonly number[],
  hidden: readonly number[],
  value: number,
  position: number,
): number[] {
  const visible = order.filter((i) => !hidden.includes(i));
  const from = visible.indexOf(value);
  if (from < 0) return [...order];

  const next = [...visible];
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(position, next.length)), 0, value);

  return [...next, ...order.filter((i) => hidden.includes(i))];
}

/** Stands for the blank in the rack order, alongside the letters' indices. */
const BLANK = -1;

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Where a drag started: the rack, or a tile already staged on the board. */
type Origin = { kind: "rack"; selection: Selection } | { kind: "cell"; x: number; y: number };

/**
 * Drafts survive a reload, and a re-mount. Keyed by turn so a draft is
 * discarded the moment the turn moves on rather than reappearing later.
 */
const draftKey = (gameId: string) => `wordcraft:draft:${gameId}`;

function readDraft(gameId: string, turnNumber: number): Staged[] {
  try {
    const raw = window.localStorage.getItem(draftKey(gameId));
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as { turnNumber: number; pending: Staged[] };
    return parsed.turnNumber === turnNumber ? parsed.pending : [];
  } catch {
    return [];
  }
}

function writeDraft(gameId: string, turnNumber: number, pending: Staged[]) {
  try {
    if (pending.length === 0) window.localStorage.removeItem(draftKey(gameId));
    else {
      window.localStorage.setItem(
        draftKey(gameId),
        JSON.stringify({ turnNumber, pending }),
      );
    }
  } catch {
    // Private browsing or a full quota: a lost draft is not worth failing over.
  }
}

export function Game({ gameId, onLeave }: { gameId: Id<"games">; onLeave: () => void }) {
  const view = useQuery(api.games.getGame, { gameId });
  const placeTiles = useMutation(api.games.placeTiles);
  const resignGame = useMutation(api.games.resignGame);
  const tradeTiles = useMutation(api.games.tradeTiles);
  const joinGame = useMutation(api.games.joinGame);
  const [copied, setCopied] = useState(false);

  const [pending, setPending] = useState<Staged[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);
  /**
   * A blank has been dropped on this square and is waiting to be told what
   * letter it stands for. Asking on release rather than beforehand means the
   * blank drags like any other tile.
   */
  const [blankAt, setBlankAt] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Rack display order, as indices into the dealt letters, with BLANK for the
   * blank so it can be moved like anything else. Purely cosmetic:
   * selections and staged tiles always travel by real index, so reordering can
   * never change which tile a placement came from.
   */
  const [rackOrder, setRackOrder] = useState<number[]>([]);
  /** Letter index the pointer is over while dragging a rack tile. */
  const [rackHover, setRackHover] = useState<number | null>(null);
  /** Tiles picked for trading. Null when not trading at all. */
  const [trading, setTrading] = useState<number[] | null>(null);

  /** Live pointer drag: the tile that follows the finger/cursor. */
  const [drag, setDrag] = useState<{
    letter: string;
    isBlank: boolean;
    x: number;
    y: number;
    origin: Origin;
  } | null>(null);
  const dragRef = useRef<{ moved: boolean } | null>(null);

  const me = view?.players.find((p) => p.letters !== null);

  const placements: Placement[] = useMemo(
    () => pending.map(({ x, y, letter, isBlank }) => ({ x, y, letter, isBlank })),
    [pending],
  );

  const boards = useMemo(() => {
    if (!view) return null;
    const before = makeBoard(view.tiles);
    return { before, after: applyPlacements(before, placements) };
  }, [view, placements]);

  const preview = useMemo(
    () => (boards && placements.length > 0 ? scoreTurn(boards.after, placements) : null),
    [boards, placements],
  );

  // The words this play would put on the board. Computed locally by the same
  // engine the server uses, so only these few words need checking.
  const candidateWords = useMemo(
    () => (boards && placements.length > 0 ? wordsFormed(boards.after, placements) : []),
    [boards, placements],
  );

  // Joined so the query argument is stable across renders with equal contents.
  const wordsKey = candidateWords.join(",");
  const checked = useQuery(
    api.games.checkWords,
    wordsKey === "" ? "skip" : { words: wordsKey.split(",") },
  );

  /**
   * Which squares belong to a word that checks out, and which to one that does
   * not. Whole runs are marked, existing tiles included, because the word is
   * what is valid or not -- not the tiles you happened to add to it.
   */
  const wordCells = useMemo(() => {
    const good = new Set<string>();
    const bad = new Set<string>();
    if (!boards || placements.length === 0 || checked === undefined) {
      return { good, bad };
    }

    const validity = new Map(checked.map((entry) => [entry.word, entry.valid]));
    const staged = new Set(placements.map((p) => `${p.x},${p.y}`));
    const inSomeRun = new Set<string>();

    for (const run of runsThrough(boards.after, placements)) {
      const target = validity.get(run.word) === true ? good : bad;
      for (const cell of run.cells) {
        const key = `${cell.x},${cell.y}`;
        inSomeRun.add(key);
        // The run's verdict, but shown only on the tiles you just placed —
        // already-played tiles are not part of this turn.
        if (staged.has(key)) target.add(key);
      }
    }

    // A tile touching nothing forms no run, so the loop above never saw it.
    // On its own it has to be a word in its own right — only A and I are.
    for (const p of placements) {
      const key = `${p.x},${p.y}`;
      if (inSomeRun.has(key)) continue;
      if (validity.get(p.letter.toUpperCase()) === true) good.add(key);
      else bad.add(key);
    }

    // Connectivity is separate from spelling: a perfectly good word that does
    // not reach the rest of the board is still an illegal play, and the board
    // should say so rather than leaving it to the message underneath.
    for (const key of disconnectedCells(boards.after, placements)) bad.add(key);

    // A square can sit in a good word one way and a bad one the other; the
    // problem is what needs pointing at.
    for (const key of bad) good.delete(key);
    return { good, bad };
  }, [boards, placements, checked]);

  /**
   * Full legality, run client-side against the words the server just
   * confirmed. Catches "not a word", but also disconnection and overlaps —
   * before the play is ever submitted.
   */
  const legality = useMemo(() => {
    if (!view || !boards || placements.length === 0) return null;
    if (checked === undefined) return null;

    const dictionary = makeDictionary(
      checked.filter((entry) => entry.valid).map((entry) => entry.word),
    );

    const shape = shapeOf(layoutByName(view.layout));
    return validateTurn(boards.before, placements, dictionary, {
      width: view.game.boardSize,
      height: view.game.boardSize,
      blocked: shape.blocked,
      centre: shape.centre,
    });
  }, [view, boards, placements, checked]);

  const rackSignature = (view?.players.find((p) => p.letters !== null)?.letters ?? []).join(
    ",",
  );
  useEffect(() => {
    const count = rackSignature === "" ? 0 : rackSignature.split(",").length;
    setRackOrder([...Array.from({ length: count }, (_, i) => i), BLANK]);
  }, [rackSignature]);

  function shuffleRack() {
    setRackOrder((current) => {
      const next = [...current];
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j]!, next[i]!];
      }
      return next;
    });
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
    setError(null);

    if (position !== null) {
      const index = tile.from.kind === "letter" ? tile.from.index : BLANK;
      // The tile is no longer staged, so it is visible again for the move.
      const stillHidden = spentIndices.filter((i) => i !== index);
      setRackOrder((current) => moveToPosition(current, stillHidden, index, position));
    }
  }

  /**
   * Order to render right now. While a rack tile is over another slot this is
   * the order it *would* become, so the gap follows the pointer instead of
   * appearing only on release.
   */
  /** Rack entries currently staged on the board, so hidden from the rack. */
  const spentIndices = useMemo(() => {
    const spent = pending
      .filter((p) => p.from.kind === "letter")
      .map((p) => (p.from as { kind: "letter"; index: number }).index);
    if (pending.some((p) => p.from.kind === "blank") || blankAt !== null) {
      spent.push(BLANK);
    }
    return spent;
  }, [pending, blankAt]);

  /**
   * The rack letter a drag concerns, whether it started in the rack or is a
   * staged tile heading back. Blanks have no rack slot to move.
   */
  const draggedLetterIndex = useMemo(() => {
    if (drag === undefined || drag === null) return null;
    if (drag.origin.kind === "rack") {
      return drag.origin.selection.kind === "letter"
        ? drag.origin.selection.index
        : BLANK;
    }
    const cell = drag.origin;
    const staged = pending.find((p) => p.x === cell.x && p.y === cell.y);
    if (staged === undefined) return null;
    return staged.from.kind === "letter" ? staged.from.index : BLANK;
  }, [drag, pending]);

  const previewOrder = useMemo(() => {
    if (draggedLetterIndex === null || rackHover === null) return rackOrder;
    const dragged = draggedLetterIndex;

    const stillHidden = spentIndices.filter((i) => i !== dragged);
    return moveToPosition(rackOrder, stillHidden, dragged, rackHover);
  }, [draggedLetterIndex, rackHover, rackOrder, spentIndices]);



  // A turn is mostly thinking, so the screen should not dim mid-thought.
  useWakeLock(view?.game.status === "active");

  const turnNumber = view?.game.turnNumber;

  // Load the draft for this turn, and drop it when the turn moves on.
  useEffect(() => {
    if (turnNumber === undefined) return;
    setPending(readDraft(gameId, turnNumber));
    setSelected(null);
    setBlankAt(null);
  }, [gameId, turnNumber]);

  useEffect(() => {
    if (turnNumber === undefined) return;
    writeDraft(gameId, turnNumber, pending);
  }, [gameId, turnNumber, pending]);

  // Kept in a ref so the pointer listeners below can call the current
  // `place` without re-subscribing on every mouse move.
  const reorderRef = useRef<(fromIndex: number, over: number | null) => void>(() => {});
  reorderRef.current = reorderRack;

  const recallRef = useRef<(from: { x: number; y: number }, over: number | null) => void>(
    () => {},
  );
  recallRef.current = recallToRack;

  const dropRef = useRef<(x: number, y: number, origin: Origin) => void>(() => {});
  dropRef.current = (x, y, origin) => {
    if (origin.kind === "cell") moveStaged(origin, x, y);
    else place(x, y);
  };

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
      if (!cell) return;

      const [cx, cy] = cell.split(",").map(Number);
      if (cx !== undefined && cy !== undefined && origin !== undefined) {
        dropRef.current(cx, cy, origin);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, drag?.origin]);

  if (view === undefined) return <p className={styles.notice}>Loading game…</p>;
  if (view === null) return <p className={styles.notice}>Game not found.</p>;

  const { game } = view;
  const myTurn =
    me !== undefined && game.status === "active" && me.seat === game.currentSeat;



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
    if (!myTurn || me === undefined) return;
    // The blank has to be answered before anything else can be moved.
    if (blankAt !== null) return;

    if (selection.kind === "blank") {
      startDrag("", true, { kind: "rack", selection }, event);
      return;
    }

    const letter = me.letters?.[selection.index];
    if (letter === undefined) return;

    startDrag(letter, false, { kind: "rack", selection }, event);
  }

  /** Drag a tile already staged this turn to a different square. */
  function grabStaged(x: number, y: number, event: ReactPointerEvent) {
    const tile = pending.find((p) => p.x === x && p.y === y);
    if (tile === undefined) return;
    startDrag(tile.letter, tile.isBlank, { kind: "cell", x, y }, event);
  }

  /** Move a staged tile, keeping the rack slot it came from. */
  function moveStaged(origin: { x: number; y: number }, x: number, y: number) {
    setPending((current) => {
      const tile = current.find((p) => p.x === origin.x && p.y === origin.y);
      if (tile === undefined) return current;
      // Refuse to stack two staged tiles on one square.
      if (current.some((p) => p.x === x && p.y === y)) return current;

      return current.map((p) => (p === tile ? { ...p, x, y } : p));
    });
    setError(null);
  }

  function place(x: number, y: number) {
    if (!myTurn || selected === null || me === undefined) return;

    if (selected.kind === "blank") {
      // Landed, but nameless: ask now.
      setBlankAt({ x, y });
      setSelected(null);
      setError(null);
      return;
    } else {
      const letter = me.letters?.[selected.index];
      if (letter === undefined) return;
      setPending((p) => [...p, { x, y, letter, isBlank: false, from: selected }]);
    }

    setSelected(null);
    setError(null);
  }

  function pickUp(x: number, y: number) {
    const tile = pending.find((p) => p.x === x && p.y === y);
    setPending((p) => p.filter((s) => !(s.x === x && s.y === y)));
    setError(null);

    // A blank's letter is a decision, so tapping it reopens that decision
    // rather than throwing the tile back to the rack.
    if (tile?.isBlank === true) setBlankAt({ x, y });
  }

  function clear() {
    setPending([]);
    setSelected(null);
    setBlankAt(null);
    setError(null);
  }

  /** The rack's swap button toggles: press again to back out. */
  function toggleTrade() {
    if (trading !== null) {
      setTrading(null);
      return;
    }
    // Trading forfeits the turn, so anything staged has to come back first.
    setPending([]);
    setSelected(null);
    setBlankAt(null);
    setTrading([]);
  }

  async function confirmTrade() {
    if (trading === null || trading.length === 0) return;
    setError(null);
    try {
      await tradeTiles({ gameId, indices: trading });
      setTrading(null);
    } catch (e) {
      setError(userMessage(e));
    }
  }


  function quit() {
    const warning =
      game.playerCount > 1
        ? "Quit this game? The other player wins it."
        : "Quit this game?";
    if (window.confirm(warning)) void resignGame({ gameId }).then(onLeave);
  }

  /** Answer the question the dropped blank is asking. */
  function nameBlank(letter: string) {
    if (blankAt === null) return;
    setPending((current) => [
      ...current,
      { x: blankAt.x, y: blankAt.y, letter, isBlank: true, from: { kind: "blank" } },
    ]);
    setBlankAt(null);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await placeTiles({
        gameId,
        placements: pending.map(({ x, y, letter, isBlank }) => ({
          x,
          y,
          letter,
          isBlank,
        })),
      });
      clear();
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  const choosingBlank = blankAt !== null;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <Board
          boardSize={game.boardSize}
          layout={view.layout}
          tiles={view.tiles}
          pending={pending}
          canPlace={myTurn && selected !== null && !choosingBlank}
          onPlace={place}
          onPickUp={pickUp}
          awaitingBlankAt={blankAt}
          goodCells={wordCells.good}
          badCells={wordCells.bad}
          onGrabStaged={myTurn ? grabStaged : undefined}
        />

        {me?.letters && (
          <Rack
            letters={me.letters}
            spent={spentIndices}
            selected={selected}
            onSelect={setSelected}
            onGrab={grab}
            order={rackOrder}
            previewOrder={previewOrder}
            draggedIndex={draggedLetterIndex}
            dragOverRack={rackHover !== null}
            onShuffle={shuffleRack}
            onRecall={clear}
            canRecall={pending.length > 0}
            trading={trading}
            onToggleTrade={(index) =>
              setTrading((current) =>
                current === null
                  ? current
                  : current.includes(index)
                    ? current.filter((i) => i !== index)
                    : [...current, index],
              )
            }
            onStartTrade={toggleTrade}
            canTrade={myTurn}
            onPlay={() => void submit()}
            canPlay={myTurn && pending.length > 0 && !submitting && legality?.ok === true}
            playing={submitting}
          />
        )}

        {blankAt !== null && (
          <div className={styles.popoverBackdrop} role="dialog" aria-modal="true">
            <div className={styles.popover}>
              <p className={styles.popoverTitle}>What does this blank stand for?</p>

              <div className={styles.letterGrid}>
                {ALPHABET.slice(0, 20).map((letter) => (
                  <button
                    key={letter}
                    type="button"
                    className={styles.blankLetter}
                    onClick={() => nameBlank(letter)}
                  >
                    {letter}
                  </button>
                ))}
              </div>
              <div className={styles.letterGridLast}>
                {ALPHABET.slice(20).map((letter) => (
                  <button
                    key={letter}
                    type="button"
                    className={styles.blankLetter}
                    onClick={() => nameBlank(letter)}
                  >
                    {letter}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className={styles.popoverBack}
                onClick={() => setBlankAt(null)}
              >
                Put the blank back on the rack
              </button>
            </div>
          </div>
        )}

        {game.status === "lobby" && (
          <div className={styles.waiting}>
            <strong>Waiting for players.</strong> {view.seatsFilled} of{" "}
            {game.playerCount} seats filled — nobody can place tiles until the
            game is full.
            {view.canJoin ? (
              <>
                {" "}
                <button
                  type="button"
                  className={styles.inline}
                  onClick={() => void joinGame({ gameId })}
                >
                  Take a seat
                </button>
              </>
            ) : (
              <>
                {" "}
                <button
                  type="button"
                  className={styles.inline}
                  onClick={() => {
                    void navigator.clipboard.writeText(window.location.href).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                >
                  {copied ? "Link copied" : "Copy the link to invite someone"}
                </button>
              </>
            )}
          </div>
        )}

        {trading !== null && (
          <div className={styles.tradeBar}>
            <span>
              {trading.length === 0
                ? "Pick the tiles to trade in."
                : `Trading ${trading.length} ${trading.length === 1 ? "tile" : "tiles"}. This forfeits your turn.`}
            </span>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => setTrading((me?.letters ?? []).map((_, i) => i))}
            >
              All
            </button>
            <button
              type="button"
              className={styles.button}
              disabled={trading.length === 0}
              onClick={() => void confirmTrade()}
            >
              Trade
            </button>
          </div>
        )}


        {(pending.length > 0 || (preview && legality?.ok)) && (
          <section className={styles.play}>
            {pending.length > 0 && (
              <div className={styles.words}>
                {checked === undefined ? (
                  <span className={styles.checking}>Checking words…</span>
                ) : (
                  // Every occurrence, not every distinct word: a letter at a
                  // crossing belongs to two words and is paid for in each, so
                  // showing AT once when it was formed twice would make the
                  // chips fail to add up to the total.
                  (preview?.words ?? []).map((scored, i) => {
                    const valid =
                      checked.find((e) => e.word === scored.word)?.valid ?? false;
                    return (
                      <span
                        key={`${scored.word}-${i}`}
                        className={[
                          styles.word,
                          valid ? styles.valid : styles.invalid,
                        ].join(" ")}
                      >
                        {scored.word}
                        {valid && <span className={styles.wordPoints}>{scored.points}</span>}
                      </span>
                    );
                  })
                )}
              </div>
            )}

            {legality !== null && !legality.ok && (
              <p className={styles.reason}>{describeLegality(legality)}</p>
            )}

            {preview && legality?.ok && breakdownOf(preview).length > 0 && (
              <div className={styles.bonus}>
                <h3 className={styles.bonusHeading}>Square bonus</h3>
                <table className={styles.breakdown}>
                  <thead>
                    <tr>
                      <th scope="col">Size</th>
                      <th scope="col">Number</th>
                      <th scope="col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdownOf(preview).map((line) => (
                      <tr key={line.size}>
                        <td>
                          <span className={styles.size}>{line.size}</span>
                        </td>
                        <td>{line.count}</td>
                        <td className={styles.rowTotal}>{line.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {preview && legality?.ok && (
              <p className={styles.scoreLine}>
                This play scores{" "}
                <span className={styles.previewScore}>{preview.total}</span>
              </p>
            )}
          </section>
        )}

        {error && <div className={styles.error}>{error}</div>}

        <DevTools gameId={gameId} />

        {drag && (
          <div
            className={[styles.dragTile, drag.isBlank ? styles.dragBlank : ""].join(" ")}
            style={{ left: drag.x, top: drag.y }}
            aria-hidden="true"
          >
            {drag.letter}
          </div>
        )}
      </div>

      <Scoreboard
        onQuit={
          game.status !== "finished" && view.yourSeat !== null ? quit : undefined
        }
        players={view.players.map((p) => ({
          userId: p.userId,
          seat: p.seat,
          score: p.score,
          name: p.name,
          isYou: p.letters !== null,
        }))}
        currentSeat={game.currentSeat}
        tileCount={game.tileCount}
        endThreshold={game.endThreshold}
        status={game.status}
      />
    </div>
  );
}
