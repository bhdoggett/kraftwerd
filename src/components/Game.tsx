import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cellKey, makeBoard } from "../../shared/engine/board";
import { makeDictionary } from "../../shared/engine/dictionary";
import {
  applyPlacements,
  validateTurn,
  wordsFormed,
  type Fault,
} from "../../shared/engine/legality";
import { boardShapeNamed } from "../../shared/boards";
import { scoreTurn, type Placement, type TurnScore } from "../../shared/engine/score";
import { STACK_CAP, RACK } from "../../shared/config";
import { newBag, tilesLeft as countTiles } from "../../shared/engine/bag";

/** How many tiles a game starts with, for the progress bar's sake. */
const BAG_SIZE = countTiles(newBag(RACK));
import { Board } from "./Board";
import { DevTools } from "./DevTools";
import styles from "./Game.module.css";
import { Rack, type Selection } from "./Rack";
import { userMessage } from "../lib/errors";
import { markCells } from "../lib/boardFeedback";
import { boardAfter, scoresAfter } from "../lib/replay";
import { moveToPosition, rackSlotUnder, shuffled } from "../lib/rackGeometry";
import { moveStagedTo, stageAt } from "../lib/staging";
import { useWakeLock } from "../lib/useWakeLock";
import { Scoreboard } from "./Scoreboard";
import { playedSinceYourTurn } from "../lib/recap";

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

/** One thing wrong with a staged play, in words a player can act on. */
function describeFault(legality: Fault): string {
  switch (legality.reason) {
    case "empty-turn":
      return "Place at least one tile.";
    case "out-of-bounds":
      return "That square is off the board.";
    case "duplicate-cell":
      return "Two tiles on the same square.";
    case "stack-full":
      return "That square is full -- no more tiles may land there.";
    case "blocked":
      return "That square cannot be played on.";
    case "missing-centre":
      return "The first word has to cover the centre square.";
    case "disconnected":
      return "Every tile must connect to the tiles already on the board.";
    case "blank-on-stack":
      return "A blank cannot be the tile that closes a square.";
    case "unchanged":
      return "A tile laid on another has to change the letter underneath it.";
    case "erased":
      return legality.words.length === 1
        ? `${legality.words[0]} was already on the board and would be covered completely. A word already played has to keep at least one of its letters.`
        : `${legality.words.join(", ")} were already on the board and would be covered completely. A word already played has to keep at least one of its letters.`;
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

/** Where a drag started: the rack, or a tile already staged on the board. */
type Origin = { kind: "rack"; selection: Selection } | { kind: "cell"; x: number; y: number };

/**
 * Drafts survive a reload, and a re-mount. Keyed by turn so a draft is
 * discarded the moment the turn moves on rather than reappearing later.
 */
const draftKey = (gameId: string) => `kraftwerd:draft:${gameId}`;

/** The key used before the rename. Read once, then dropped. */
const legacyDraftKey = (gameId: string) => `wordcraft:draft:${gameId}`;

function readDraft(gameId: string, turnNumber: number): Staged[] {
  try {
    let raw = window.localStorage.getItem(draftKey(gameId));
    if (raw === null) {
      raw = window.localStorage.getItem(legacyDraftKey(gameId));
      if (raw !== null) window.localStorage.removeItem(legacyDraftKey(gameId));
    }
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

/** One line saying what a turn did, for the review bar. */
function describeTurn(turn: {
  name: string;
  kind: "play" | "pass" | "trade";
  words: readonly string[];
  score: number;
  squares: readonly number[];
}) {
  if (turn.kind === "pass") return `${turn.name} passed`;
  if (turn.kind === "trade") return `${turn.name} traded tiles`;

  const squares = turn.squares.filter((n) => n >= 2);
  const made = squares.length === 0 ? "" : ` and closed a ${squares[0]}\u00d7${squares[0]}`;
  return `${turn.name} played ${turn.words.join(", ")} for ${turn.score}${made}`;
}

export function Game({ gameId, onLeave }: { gameId: Id<"games">; onLeave: () => void }) {
  const view = useQuery(api.games.getGame, { gameId });
  /** Only for what a guest may not do; the game itself does not care. */
  const viewer = useQuery(api.users.viewer);
  const placeTiles = useMutation(api.games.placeTiles);
  const resignGame = useMutation(api.games.resignGame);
  const tradeTiles = useMutation(api.games.tradeTiles);
  const passTurn = useMutation(api.games.passTurn);
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
  /**
   * Why a tile just bounced back.
   *
   * The rules refuse some placements before they land — a letter on its own
   * twin, a square that is full, a blank on top of a tile — and until now the
   * tile simply returned to the rack, which reads as the drag having missed.
   * Every other refusal in the game says what it was.
   */
  const [refusal, setRefusal] = useState<string | null>(null);
  const refusalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The turn whose recap has already had its two seconds. Kept rather than
   * the squares themselves: what to point out is worked out while rendering,
   * and all this has to remember is that the reminder is over.
   */
  const [recapShown, setRecapShown] = useState<number | null>(null);
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
  /** Whether the pass confirmation is showing. */
  const [passing, setPassing] = useState(false);
  /**
   * Winding back through the turns. Null when watching the game itself.
   *
   * Looking only: nothing here can play, and the live board is one press
   * away — a review that could change the game would be a different feature
   * and a much more frightening one.
   */
  const [reviewing, setReviewing] = useState(false);
  const [stepAt, setStepAt] = useState<number | null>(null);
  // Not fetched until asked for: most visits never open the history.
  const history = useQuery(api.games.listTurns, reviewing ? { gameId } : "skip");

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
    () =>
      boards && placements.length > 0
        ? scoreTurn(boards.after, placements, { before: boards.before })
        : null,
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
    if (!boards || placements.length === 0 || checked === undefined) {
      return { good: new Set<string>(), bad: new Set<string>() };
    }
    return markCells(
      boards.after,
      placements,
      new Map(checked.map((entry) => [entry.word, entry.valid])),
    );
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

    const shape = boardShapeNamed(view.layout, view.game.boardSize);
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
    setRackOrder(Array.from({ length: count }, (_, i) => i));
  }, [rackSignature]);

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
    setError(null);

    if (position !== null && tile.from.kind === "letter") {
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
  /** Letters currently staged on the board, so hidden from the rack. */
  const spentIndices = useMemo(
    () =>
      pending
        .filter((p) => p.from.kind === "letter")
        .map((p) => (p.from as { kind: "letter"; index: number }).index),
    [pending],
  );

  /** Blanks still in hand: the allowance less any staged or being named. */
  const blanksLeft = Math.max(
    0,
    (me?.blanks ?? 0) -
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

  const previewOrder = useMemo(() => {
    if (draggedLetterIndex === null || rackHover === null) return rackOrder;
    const dragged = draggedLetterIndex;

    const stillHidden = spentIndices.filter((i) => i !== dragged);
    return moveToPosition(rackOrder, stillHidden, dragged, rackHover);
  }, [draggedLetterIndex, rackHover, rackOrder, spentIndices]);



  /** What was played while you were away, to point out as your turn opens. */
  const playedSinceYou = useMemo(
    () =>
      view === undefined || view === null
        ? new Set<string>()
        : playedSinceYourTurn(view.tiles, view.viewerUserId),
    [view],
  );

  const yourTurn =
    view?.game.status === "active" &&
    view.yourSeat !== null &&
    view.yourSeat === view.game.currentSeat;

  /**
   * Squares to point out right now, or null when there is nothing to say.
   *
   * Shown once, as the turn opens: a reminder of what you missed belongs at
   * the moment you arrive and nowhere after. Worked out here rather than held
   * in state, so it follows the board instead of going stale behind it.
   */
  const recap =
    yourTurn && !reviewing && recapShown !== view?.game.turnNumber && playedSinceYou.size > 0
      ? playedSinceYou
      : null;

  // The only thing the timer does is end it.
  useEffect(() => {
    if (recap === null) return;
    const turn = view?.game.turnNumber;
    const done = setTimeout(() => setRecapShown(turn ?? null), 2200);
    return () => clearTimeout(done);
  }, [recap, view?.game.turnNumber]);

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

  /** Whoever the game is waiting on, so a press on Play can name them. */
  const playerOnTurn =
    game.status === "active"
      ? view.players.find((p) => p.seat === game.currentSeat)
      : undefined;



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
    if (me === undefined) return;
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
    const moving = pending.find((p) => p.x === origin.x && p.y === origin.y);
    if (moving !== undefined) {
      // Landing it there would change nothing, so it stays where it was.
      if (changesNothing(x, y, moving.letter)) {
        refuse(`That square is already ${moving.letter} — a tile has to change it.`);
        return;
      }
      if (isFull(x, y)) {
        refuse(`That square is full — ${STACK_CAP} tiles is the limit.`);
        return;
      }
      if (moving.isBlank && blankBlocked(x, y)) {
        refuse("A blank can only go on an empty square.");
        return;
      }
    }

    setPending((current) => moveStagedTo(current, origin, x, y));
    setError(null);
  }

  /**
   * Whether a letter would land on the same letter, changing nothing.
   *
   * The rules refuse such a play, so there is no point letting it be staged
   * and explaining afterwards: the tile simply does not land, and goes back
   * where it came from.
   */
  function changesNothing(x: number, y: number, letter: string) {
    return boards?.before.get(cellKey(x, y))?.letter === letter.toUpperCase();
  }

  /**
   * Whether a square has taken all the tiles it ever will.
   *
   * The rules refuse a play there, so the tile does not land: it goes back
   * where it came from rather than sitting on the board waiting to be told
   * on Play.
   */
  function isFull(x: number, y: number) {
    return (boards?.before.get(cellKey(x, y))?.stacked ?? 0) >= STACK_CAP;
  }

  /** Say why a tile did not land, and take it back down after a moment. */
  function refuse(why: string) {
    setRefusal(why);
    if (refusalTimer.current !== null) clearTimeout(refusalTimer.current);
    refusalTimer.current = setTimeout(() => setRefusal(null), 2600);
  }

  /** A blank may start a square but not close one, so it bounces off a stack. */
  function blankBlocked(x: number, y: number) {
    const deep = boards?.before.get(cellKey(x, y))?.stacked ?? 0;
    return deep > 0 && deep + 1 >= STACK_CAP;
  }

  function place(x: number, y: number) {
    if (selected === null || me === undefined) return;

    if (selected.kind === "blank") {
      // A full square takes nothing, and a blank cannot be the tile that
      // closes one: no point asking what it stands for when it cannot land.
      if (isFull(x, y)) {
        refuse(`That square is full — ${STACK_CAP} tiles is the limit.`);
        setSelected(null);
        return;
      }
      if (blankBlocked(x, y)) {
        refuse("A blank can only go on an empty square.");
        setSelected(null);
        return;
      }
      // Landed, but nameless: ask now.
      setBlankAt({ x, y });
      setSelected(null);
      setError(null);
      return;
    } else {
      const letter = me.letters?.[selected.index];
      if (letter === undefined) return;
      if (changesNothing(x, y, letter)) {
        refuse(`That square is already ${letter} — a tile has to change it.`);
        setSelected(null);
        return;
      }
      if (isFull(x, y)) {
        refuse(`That square is full — ${STACK_CAP} tiles is the limit.`);
        setSelected(null);
        return;
      }
      setPending((p) => stageAt(p, { x, y, letter, isBlank: false, from: selected }));
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

  /** Pressing Pass asks first: one tap should not cost a turn by accident. */
  function togglePass() {
    setPassing((current) => !current);
    if (!passing) {
      setPending([]);
      setSelected(null);
      setBlankAt(null);
      setTrading(null);
    }
  }

  async function confirmPass() {
    setError(null);
    try {
      await passTurn({ gameId });
      setPassing(false);
    } catch (e) {
      setError(userMessage(e));
    }
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
    // A game still in the lobby is called off rather than lost, so promising
    // the other player a win would be wrong.
    const warning =
      game.turnNumber === 0
        ? "Leave this game? Nobody has played yet, so it goes no further."
        : game.playerCount > 1
          ? "Quit this game? The other player wins it."
          : "Quit this game?";
    if (window.confirm(warning)) void resignGame({ gameId }).then(onLeave);
  }

  /** Answer the question the dropped blank is asking. */
  function nameBlank(letter: string) {
    if (blankAt === null) return;
    // A blank standing for the letter already there is no change either.
    if (changesNothing(blankAt.x, blankAt.y, letter)) {
      refuse(`That square is already ${letter} — a tile has to change it.`);
      setBlankAt(null);
      return;
    }
    setPending((current) =>
      stageAt(current, {
        x: blankAt.x,
        y: blankAt.y,
        letter,
        isBlank: true,
        from: { kind: "blank" },
      }),
    );
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

  /** Players who have been asked but have not taken their seat yet. */
  const invitees = view.players.filter((p) => p.invited === true).map((p) => p.name);

  // Player id to seat, which is how a tile knows what colour to be.
  const seatOf = new Map(view.players.map((p) => [p.userId, p.seat]));

  const turns = history ?? [];
  // Fresh review starts at the end: the board you were just looking at.
  const step = stepAt ?? turns.length;
  const ready = reviewing && history !== undefined;
  // Live tiles until the history has actually arrived: swapping in an empty
  // board while it loads reads as the game having been wiped, which is the
  // one thing a review must never look like.
  const shown = ready ? boardAfter(turns, step) : view.tiles;
  const lastTurn = step > 0 ? turns[step - 1] : undefined;

  /*
   * Scores as they stood at this point in the review, so they count up with
   * the board instead of sitting at the final total from the first frame.
   *
   * The last frame keeps the real scores: the game's end hands whoever went
   * out what everyone else was still holding, and that swing is not a turn,
   * so counting turns alone would stop a few points short of how it ended.
   */
  const reviewScores =
    ready && step < turns.length ? scoresAfter(turns, step) : null;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        {/* The refusal floats over the board, so the board is what it is
            measured against. */}
        <div className={styles.boardArea}>
          <Board
            boardSize={game.boardSize}
            layout={view.layout}
            tiles={shown}
            pending={ready ? [] : pending}
            seatOf={seatOf}
            yourSeat={view.yourSeat}
            /* Not gated on the turn: a play can be laid out and priced while
               you wait, which is when there is time to think about it.
               Playing it is what needs the turn -- the Play button stays off,
               and the server would refuse it anyway. */
            canPlace={!reviewing && selected !== null && !choosingBlank}
            onPlace={place}
            onPickUp={pickUp}
            awaitingBlankAt={blankAt}
            goodCells={wordCells.good}
            badCells={wordCells.bad}
            recentCells={recap ?? undefined}
            onGrabStaged={!reviewing ? grabStaged : undefined}
          />

          {/* Floats over the board rather than sitting in the column: a message
              that pushed the layout down would move the square you were aiming
              at. */}
          {refusal !== null && (
            <div className={styles.refusal} role="status" aria-live="polite">
              {refusal}
            </div>
          )}
        </div>


        {/* Nothing left to play once it is over: the rack would be a row of
            tiles the game will never take. The scores stay. */}
        {reviewing && (
          <div className={styles.review}>
            {!ready ? (
              <span className={styles.reviewSays}>Fetching the turns…</span>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.reviewStep}
                  aria-label="Back a turn"
                  disabled={step === 0}
                  onClick={() => setStepAt(Math.max(0, step - 1))}
                >
                  ◀
                </button>
                <input
                  type="range"
                  className={styles.scrubber}
                  min={0}
                  max={turns.length}
                  value={step}
                  aria-label="Turn"
                  onChange={(e) => setStepAt(Number(e.target.value))}
                />
                <button
                  type="button"
                  className={styles.reviewStep}
                  aria-label="On a turn"
                  disabled={step === turns.length}
                  onClick={() => setStepAt(Math.min(turns.length, step + 1))}
                >
                  ▶
                </button>
                <button
                  type="button"
                  className={styles.reviewDone}
                  onClick={() => {
                    setReviewing(false);
                    setStepAt(null);
                  }}
                >
                  Done
                </button>
                <span className={styles.reviewSays}>
                  {lastTurn === undefined
                    ? "Before the first turn"
                    : describeTurn(lastTurn)}
                </span>
              </>
            )}
          </div>
        )}

        {me?.letters && game.status !== "finished" && !reviewing && (
          <Rack
            seat={view.yourSeat}
            letters={me.letters}
            spent={spentIndices}
            blanks={blanksLeft}
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
            /* Trading needs tiles to trade for; once the bag is dry the same
               button becomes the only way out of a rack that will not play. */
            canTrade={myTurn && view.tilesLeft > 0}
            onPass={togglePass}
            canPass={myTurn && view.tilesLeft === 0}
            passing={passing}
            onPlay={() => {
              // Pressing Play while somebody else is thinking is a fair
              // question, and this is the answer to it.
              if (!myTurn) {
                refuse(playerOnTurn === undefined ? "Not your turn yet." : `It's ${playerOnTurn.name}'s turn.`);
                return;
              }
              void submit();
            }}
            canPlay={myTurn && pending.length > 0 && !submitting && legality?.ok === true}
            playAnswers={!myTurn}
            playing={submitting}
          />
        )}

        {blankAt !== null && (
          <div
            className={styles.popoverBackdrop}
            role="dialog"
            aria-modal="true"
            // Pressing away takes the blank back, which is what the button
            // under the letters used to say in words.
            onClick={(e) => {
              if (e.target === e.currentTarget) setBlankAt(null);
            }}
          >
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

            </div>
          </div>
        )}

        {game.status === "lobby" && (
          <div className={styles.waiting}>
            {/* Name who has not arrived: "2 of 3 seats filled" says how many
                are missing, never which. */}
            <strong>Waiting for players.</strong> {view.seatsFilled} of{" "}
            {game.playerCount} seats filled
            {invitees.length > 0 && <> — yet to accept: {invitees.join(", ")}</>}
            . Nobody can place tiles until the game is full.
            {view.canJoin && viewer?.isGuest === true ? (
              // A guest cannot hold a seat: the mutation refuses it, and being
              // told why here beats pressing a button that says no.
              <> Playing with people needs an account — make one from the menu.</>
            ) : view.canJoin ? (
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

        {passing && myTurn && (
          <div className={styles.tradeBar}>
            <span>
              Pass your turn? The bag is empty, so there is nothing to trade
              for.
            </span>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => setPassing(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() => void confirmPass()}
            >
              Pass
            </button>
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



        {error && <div className={styles.error}>{error}</div>}

        <DevTools gameId={gameId} />

        {drag && (
          <div
            className={[styles.dragTile, drag.isBlank ? styles.dragBlank : ""].join(" ")}
            data-seat={view.yourSeat === null ? undefined : view.yourSeat % 4}
            style={{ left: drag.x, top: drag.y }}
            aria-hidden="true"
          >
            {drag.letter}
          </div>
        )}
      </div>

      <div className={styles.side}>
        <Scoreboard
          onQuit={
            game.status !== "finished" && view.yourSeat !== null ? quit : undefined
          }
          players={view.players.map((p) => ({
            userId: p.userId,
            seat: p.seat,
            score: reviewScores === null ? p.score : (reviewScores.get(p.userId) ?? 0),
            name: p.name,
            isYou: p.letters !== null,
            // Not while a review is mid-game: the hand it would name is the
            // one held now, not the one held then.
            tilesInHand: reviewScores === null ? p.letterCount : null,
          }))}
          currentSeat={game.currentSeat}
          tileCount={game.tileCount}
          tilesLeft={view.tilesLeft}
          bagSize={BAG_SIZE}
            status={game.status}
        />

        {/*
          Only once it is over. Mid-game the board in front of you is the one
          that matters, and winding back through it while a turn is owed is a
          way to lose your place rather than find it.
        */}
        {game.status === "finished" && game.turnNumber > 0 && !reviewing && (
          <button
            type="button"
            className={styles.reviewOpen}
            onClick={() => setReviewing(true)}
          >
            Review turns
          </button>
        )}


        {/*
          Everything here comes from the placement itself — the words, their
          points, the squares, the total — so it is all drawn the moment a tile
          lands. Only whether a word is a word waits on the server, and that
          changes a chip's colour rather than whether it is there. Swapping the
          whole panel for "checking…" and back was what made the page jump on
          every tile.
        */}
        {pending.length > 0 && (
          <section className={styles.play}>
            <div className={styles.words}>
              {/* Every occurrence, not every distinct word: a letter at a
                  crossing belongs to two words and is paid for in each, so
                  showing AT once when it was formed twice would make the
                  chips fail to add up to the total. */}
              {(preview?.words ?? []).map((scored, i) => {
                const valid = checked?.find((e) => e.word === scored.word)?.valid;
                // A real word the play cannot make — unreachable, or burying
                // something — is marked wrong without the line through it.
                // The line means "not a word", and this one is a word.
                const unplayable =
                  valid === true && legality !== null && !legality.ok;
                return (
                  <span
                    key={`${scored.word}-${i}`}
                    className={[
                      styles.word,
                      valid === undefined
                        ? styles.checking
                        : unplayable
                          ? styles.blockedWord
                          : valid
                            ? styles.valid
                            : styles.invalid,
                    ].join(" ")}
                  >
                    {scored.word}
                    {/* While the verdict is out the points hold their space, so
                        the chip does not resize when it lands. Once the answer
                        is in and the word scores nothing, the space goes: it
                        cannot change again, and an empty gap reads as a bug. */}
                    {valid === undefined ? (
                      <span className={[styles.wordPoints, styles.pointsHidden].join(" ")}>
                        {scored.points}
                      </span>
                    ) : (
                      valid &&
                      !unplayable && <span className={styles.wordPoints}>{scored.points}</span>
                    )}
                  </span>
                );
              })}
            </div>

            {/*
              Always here, so the panel cannot change height when the verdict
              lands. Legality is null while the words are being checked, and a
              line that comes and goes on every tile shortens the page — enough
              that, scrolled near the bottom, the browser clamps the scroll and
              the whole board appears to jump.
            */}
            {/* One line per thing wrong, since a play can be wrong in more
                than one way -- disconnected and not a word at once. Each line
                still gathers its own kind, so a play with three bad words
                says so once. */}
            <div
              className={[
                styles.reasons,
                legality === null || legality.ok ? styles.reasonQuiet : "",
              ].join(" ")}
            >
              {legality !== null && !legality.ok ? (
                legality.faults.map((fault) => (
                  <p key={fault.reason} className={styles.reason}>
                    {describeFault(fault)}
                  </p>
                ))
              ) : (
                <p className={styles.reason}>Checking your play…</p>
              )}
            </div>

            {preview && breakdownOf(preview).length > 0 && (
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

            {preview && preview.stackBonus > 0 && (
              <p className={styles.scoreLine}>
                Landing on a stacked square:{" "}
                <span className={styles.previewScore}>+{preview.stackBonus}</span>
              </p>
            )}

            {preview && (
              <p className={styles.scoreLine}>
                This play scores{" "}
                {/* A play that is not legal scores nothing, whatever its
                    words and squares would have added up to. The line stays
                    put either way: it is the panel changing height that made
                    the page jump. */}
                <span
                  className={[
                    styles.previewScore,
                    legality?.ok === true ? "" : styles.previewNothing,
                  ].join(" ")}
                >
                  {legality?.ok === true ? preview.total : 0}
                </span>
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
