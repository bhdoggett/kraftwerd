import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { makeBoard } from "../../shared/engine/board";
import { makeDictionary } from "../../shared/engine/dictionary";
import { applyPlacements, validateTurn, wordsFormed } from "../../shared/engine/legality";
import { runsThrough } from "../../shared/engine/runs";
import { scoreTurn, type Placement } from "../../shared/engine/score";
import { Board } from "./Board";
import { DevTools } from "./DevTools";
import styles from "./Game.module.css";
import { Rack, type Selection } from "./Rack";
import { userMessage } from "../lib/errors";
import { Scoreboard } from "./Scoreboard";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

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
  if (tiles.length === 0) return miss;

  // Strictly over the tiles themselves, not the rack panel: the label and the
  // shuffle/recall buttons share that box, and drifting over them should not
  // rearrange anything. Nothing in the rack moves until the pointer is
  // genuinely on it.
  const bounds = rack.getBoundingClientRect();
  if (clientY < bounds.top || clientY > bounds.bottom) return miss;

  // The blank sits after the letters and is not a drop position itself, but
  // the gap before it is: without including it, the space between the last
  // letter and the blank fell outside the rack entirely and could not be
  // dropped into.
  const blank = rack.querySelector("[data-rack-blank]");
  const rightEdge =
    blank instanceof HTMLElement
      ? blank.getBoundingClientRect().right
      : tiles[tiles.length - 1]!.getBoundingClientRect().right;

  const first = tiles[0]!.getBoundingClientRect();
  if (clientX < first.left || clientX > rightEdge) return miss;

  const localX = clientX - bounds.left + rack.scrollLeft;

  // Position, not identity. The tiles are visually shifted by the preview
  // while their layout boxes stay put, so asking "which letter is under the
  // pointer" gives an answer that disagrees with what the player sees — that
  // mismatch is what made a drag skip past letters. Asking "which slot is the
  // pointer in" is the same question in both frames.
  for (const [position, el] of tiles.entries()) {
    if (localX < el.offsetLeft + el.offsetWidth) return { overRack: true, position };
  }
  return { overRack: true, position: tiles.length - 1 };
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
   * Rack display order, as indices into the dealt letters. Purely cosmetic:
   * selections and staged tiles always travel by real index, so reordering can
   * never change which tile a placement came from.
   */
  const [rackOrder, setRackOrder] = useState<number[]>([]);
  /** Letter index the pointer is over while dragging a rack tile. */
  const [rackHover, setRackHover] = useState<number | null>(null);

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
    const inSomeRun = new Set<string>();

    for (const run of runsThrough(boards.after, placements)) {
      const target = validity.get(run.word) === true ? good : bad;
      for (const cell of run.cells) {
        target.add(`${cell.x},${cell.y}`);
        inSomeRun.add(`${cell.x},${cell.y}`);
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

    return validateTurn(boards.before, placements, dictionary, {
      width: view.game.boardSize,
      height: view.game.boardSize,
    });
  }, [view, boards, placements, checked]);

  const rackSignature = (view?.players.find((p) => p.letters !== null)?.letters ?? []).join(
    ",",
  );
  useEffect(() => {
    const count = rackSignature === "" ? 0 : rackSignature.split(",").length;
    setRackOrder(Array.from({ length: count }, (_, i) => i));
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

    if (tile.from.kind === "letter" && position !== null) {
      const index = tile.from.index;
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
  /** Rack letters currently staged on the board, so hidden from the rack. */
  const spentIndices = useMemo(
    () =>
      pending
        .filter((p) => p.from.kind === "letter")
        .map((p) => (p.from as { kind: "letter"; index: number }).index),
    [pending],
  );

  /**
   * The rack letter a drag concerns, whether it started in the rack or is a
   * staged tile heading back. Blanks have no rack slot to move.
   */
  const draggedLetterIndex = useMemo(() => {
    if (drag === undefined || drag === null) return null;
    if (drag.origin.kind === "rack") {
      return drag.origin.selection.kind === "letter" ? drag.origin.selection.index : null;
    }
    const cell = drag.origin;
    const staged = pending.find((p) => p.x === cell.x && p.y === cell.y);
    return staged?.from.kind === "letter" ? staged.from.index : null;
  }, [drag, pending]);

  const previewOrder = useMemo(() => {
    if (draggedLetterIndex === null || rackHover === null) return rackOrder;
    const dragged = draggedLetterIndex;

    const stillHidden = spentIndices.filter((i) => i !== dragged);
    return moveToPosition(rackOrder, stillHidden, dragged, rackHover);
  }, [draggedLetterIndex, rackHover, rackOrder, spentIndices]);



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


  // Also spent while the dropped blank is still being named.
  const blankSpent = pending.some((p) => p.from.kind === "blank") || blankAt !== null;

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
    setPending((p) => p.filter((s) => !(s.x === x && s.y === y)));
    setError(null);
  }

  function clear() {
    setPending([]);
    setSelected(null);
    setBlankAt(null);
    setError(null);
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
            blank={me.blank}
            spent={spentIndices}
            blankSpent={blankSpent}
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
          />
        )}

        {blankAt !== null && (
          <div className={styles.blankPicker}>
            <p className={styles.blankPrompt}>
              What does this blank stand for?
              <button
                type="button"
                className={styles.inline}
                onClick={() => setBlankAt(null)}
              >
                Cancel
              </button>
            </p>
            {ALPHABET.map((letter) => (
              <button
                key={letter}
                type="button"
                className={styles.blankLetter}
                onClick={() => nameBlank(letter)}
                autoFocus={letter === "A"}
              >
                {letter}
              </button>
            ))}
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

        {game.status === "active" && !myTurn && (
          <p className={styles.hint}>
            Waiting for{" "}
            {view.players.find((p) => p.seat === game.currentSeat)?.name ??
              `seat ${game.currentSeat + 1}`}{" "}
            to play.
          </p>
        )}

        {game.status === "finished" && (
          <p className={styles.hint}>
            {(() => {
              const winners = game.winnerIds ?? [];
              const names = view.players
                .filter((p) => winners.includes(p.userId))
                .map((p) => p.name);
              const youWon = view.players.some(
                (p) => p.letters !== null && winners.includes(p.userId),
              );
              if (names.length === 0) return "Game over.";
              if (youWon && names.length === 1) return "Game over — you win.";
              return names.length === 1
                ? `Game over — ${names[0]} wins.`
                : `Game over — ${names.join(" and ")} tie.`;
            })()}
          </p>
        )}

        {myTurn && (
          <p className={styles.hint}>
            {selected === null
              ? "Pick a letter from your rack, then drag it onto the board or tap a highlighted square."
              : choosingBlank
                ? "Choose the letter your blank stands for."
                : "Now drop it on a highlighted square. Tap a placed tile to take it back."}
          </p>
        )}

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.button}
            disabled={!myTurn || pending.length === 0 || submitting || !legality?.ok}
            onClick={() => void submit()}
          >
            {submitting ? "Playing…" : "Play"}
          </button>
          {preview && legality?.ok && (
            <span className={styles.preview}>
              This play scores <span className={styles.previewScore}>{preview.total}</span>
              {preview.squares.length > 0 &&
                ` · squares ${preview.squares.map((k) => `${k}×${k}`).join(", ")}`}
            </span>
          )}


          {game.status !== "finished" && view.yourSeat !== null && (
            <button
              type="button"
              className={styles.quit}
              onClick={() => {
                const others = game.playerCount > 1;
                const warning = others
                  ? "Quit this game? The other player wins it."
                  : "Quit this game?";
                if (window.confirm(warning)) {
                  void resignGame({ gameId }).then(onLeave);
                }
              }}
            >
              Quit
            </button>
          )}

        </div>

        {pending.length > 0 && (
          <div className={styles.words}>
            {checked === undefined ? (
              <span className={styles.checking}>Checking words…</span>
            ) : (
              checked.map((entry) => (
                <span
                  key={entry.word}
                  className={[styles.word, entry.valid ? styles.valid : styles.invalid].join(
                    " ",
                  )}
                >
                  {entry.word}
                </span>
              ))
            )}
            {legality !== null && !legality.ok && (
              <span className={styles.reason}>{describeLegality(legality)}</span>
            )}
          </div>
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
