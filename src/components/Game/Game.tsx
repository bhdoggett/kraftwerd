import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cellKey, makeBoard } from "../../../shared/engine/board";
import { makeDictionary } from "../../../shared/engine/dictionary";
import {
  applyPlacements,
  validateTurn,
  wordsFormed,
  type Fault,
} from "../../../shared/engine/legality";
import { boardShapeNamed } from "../../../shared/boards";
import { scoreTurn, type Placement, type TurnScore } from "../../../shared/engine/score";
import {
  STACK_CAP,
  GAME,
  BAG_SIZE,
  LONG_WORD_BONUS,
} from "../../../shared/config";
import { Board } from "../Board/Board";
import { DevTools } from "../DevTools/DevTools";
import styles from "./Game.module.css";
import { withoutLevel } from "../../../shared/names";
import { useTurnReplay } from "./useTurnReplay";
import { Rack, type Selection } from "../Rack/Rack";
import { userMessage } from "../../lib/errors";
import { HintPanel } from "../HintPanel/HintPanel";
import { hintFor, NO_HINT, shownHint, stageHint, type HintState } from "../../lib/stageHint";
import { nearSquares } from "../../../shared/engine/nearSquares";
import type { HintMove } from "../../../shared/sim/coach";
import { markCells } from "../../lib/boardFeedback";
import { boardAfter, scoresAfter } from "../../lib/replay";
import { squareBreakdown } from "../../lib/breakdown";
import { moveToPosition, rackSlotUnder, shuffled } from "../../lib/rackGeometry";
import { readDraft, writeDraft } from "../../lib/draft";
import { moveStagedTo, stageAt } from "../../lib/staging";
import { useWakeLock } from "../../lib/useWakeLock";
import { followPointer } from "../../lib/followPointer";
import { Scoreboard } from "../Scoreboard/Scoreboard";
import { Modal } from "../Modal/Modal";
import { SeatPicker } from "../SeatPicker/SeatPicker";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");


/**
 * The score split by what earned it: the tiles themselves, then each size of
 * square. Every tile is a 1×1 worth 1, and a k×k is worth k², so the whole
 * scoring rule is legible from the table.
 */
/** Squares only: the words carry their own points beside each word. */
/**
 * The square bonus, split by size. The arithmetic lives in
 * `src/lib/breakdown.ts`, where it can be tested: it was computing a block's
 * worth as `size * size` long after squares went flat, so this table showed
 * 9 for a 3x3 the turn's own total had paid 33 for.
 */
const breakdownOf = (score: TurnScore) => squareBreakdown(score.squares);

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

export function Game({
  gameId,
  onLeave,
  /** Where playing these people again goes: the table it just made. */
  onOpen,
}: {
  gameId: Id<"games">;
  onLeave: () => void;
  onOpen: (gameId: Id<"games">) => void;
}) {
  const view = useQuery(api.games.getGame, { gameId });
  /** Only for what a guest may not do; the game itself does not care. */
  const viewer = useQuery(api.users.viewer);
  const placeTiles = useMutation(api.games.placeTiles);
  const resignGame = useMutation(api.games.resignGame);
  const swapTiles = useMutation(api.games.swapTiles);
  const passTurn = useMutation(api.games.passTurn);
  const joinGame = useMutation(api.games.joinGame);
  const rematch = useMutation(api.games.rematch);
  const askHints = useAction(api.coach.hints);
  const [hintState, setHintState] = useState<HintState>(NO_HINT);
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
  /** Whether the swap confirmation is showing. */
  const [swapping, setSwapping] = useState(false);
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
  /** The warning a Quit press is asking to be confirmed against, while it is asked. */
  const [quitting, setQuitting] = useState<string | null>(null);
  /** Colour picked while taking an open seat at a game reached by link. */
  const [joinSeatChoice, setJoinSeatChoice] = useState<number | null>(null);

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

  const preview = useMemo(() => {
    if (!boards || placements.length === 0 || !view) return null;
    // Mirrors the server's own boardShape(game): bonus squares are the same
    // regardless of layout, so the live preview and the played score agree.
    const shape = boardShapeNamed(view.layout, view.game.boardSize);
    return scoreTurn(boards.after, placements, {
      before: boards.before,
      bonusSquares: shape.bonusSquares,
    });
  }, [boards, placements, view]);

  /** 3x3s this pending move leaves one tile short -- said aloud in practice games. */
  const leftOpen = useMemo(() => {
    if (!view || view.game.hints !== true || !boards || placements.length === 0) return 0;
    const shape = boardShapeNamed(view.layout, view.game.boardSize);
    return nearSquares(boards.before, placements, shape, view.game.boardSize).length;
  }, [view, boards, placements]);

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
   *
   * Both boards go in, because one of the answers depends on what was there
   * before: a tile that paves over a word entirely is wrong however good the
   * word it spells.
   */
  const wordCells = useMemo(() => {
    if (!boards || placements.length === 0 || checked === undefined) {
      return { good: new Set<string>(), bad: new Set<string>() };
    }
    return markCells(
      boards,
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

  // Other players' plays: the catch-up replay and plays landing as you watch.
  const { history, board: replayBoard, recapActive, skipRecap, skipAll, noteSpot, noteTurn } =
    useTurnReplay({ gameId, view, reviewing });

  /*
   * Where you stand with the other people at this table, for the invite under
   * Review turns: friends already, asked, asking, or nothing yet. Read only
   * while that panel is open -- most turns never ask, and friendships are kept
   * out of the board's own subscription on purpose (see `getGame`).
   */
  const friendStates = useQuery(api.friends.statesAt, { gameId });
  const inviteFriend = useMutation(api.friends.inviteFromGame);


  // A turn is mostly thinking, so the screen should not dim mid-thought.
  useWakeLock(view?.game.status === "active");

  const turnNumber = view?.game.turnNumber;
  // A hint belongs to the game and turn it was asked on; anything stored under
  // another key (a previous game, an earlier turn, a late reply) reads as none.
  /*
   * Which rack a hint was asked for: the game, the turn, and whether the
   * rack has been swapped since. A swap keeps the turn, so without the last
   * part the old rack's hints stayed up after the letters had changed.
   */
  const hintKey = `${gameId}:${turnNumber}:${me?.swapped === true ? "swapped" : ""}`;
  const hint = hintFor(hintState, hintKey);
  /**
   * Whether a draft still means anything here. A game that is over takes no
   * more turns, so the tiles staged for one belong to nothing -- and quitting
   * ends a game without moving the turn on, which is how they used to come
   * back on the final board.
   */
  const playable =
    view !== undefined && view !== null && view.game.status !== "finished";

  // Load the draft for this turn, and drop it when the turn moves on.
  useEffect(() => {
    if (turnNumber === undefined) return;
    setPending(readDraft<Staged>(gameId, turnNumber, playable));
    setSelected(null);
    setBlankAt(null);
  }, [gameId, turnNumber, playable]);

  useEffect(() => {
    if (turnNumber === undefined) return;
    writeDraft(gameId, turnNumber, pending, playable);
  }, [gameId, turnNumber, pending, playable]);

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

    return followPointer(onMove, onUp);
  }, [dragging, drag?.origin]);

  if (view === undefined) return <p className={styles.notice}>Loading game…</p>;
  if (view === null) return <p className={styles.notice}>Game not found.</p>;

  const { game } = view;
  const myTurn =
    me !== undefined && game.status === "active" && me.seat === game.currentSeat;

  /*
   * Play-out, once the bag is empty (§6): everyone plays out what they hold,
   * and the game ends when all are out or a full round goes by with nobody
   * placing a tile. Nothing else in the UI says the ending has begun.
   */
  const playingOut = game.status === "active" && view.tilesLeft === 0;
  const meOut =
    me !== undefined && (me.letters?.length ?? 0) === 0 && me.blanks === 0;

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

  async function ask() {
    const key = hintKey;
    setHintState({ key, result: null, loading: true, error: null });
    try {
      const result = await askHints({ gameId });
      setHintState({ key, result, loading: false, error: null });
    } catch (err) {
      setHintState({ key, result: null, loading: false, error: userMessage(err) });
    }
  }

  function pick(move: HintMove) {
    if (!me?.letters) return;
    const staged = stageHint(move.placements, me.letters);
    if (staged === null) {
      refuse("That hint no longer fits your rack.");
      return;
    }
    setSelected(null);
    setBlankAt(null);
    setPassing(false);
    setSwapping(false);
    setPending(staged);
  }

  /** Say why a tile did not land, and take it back down after a moment. */
  function refuse(why: string) {
    setRefusal(why);
    if (refusalTimer.current !== null) clearTimeout(refusalTimer.current);
    refusalTimer.current = setTimeout(() => setRefusal(null), 2600);
  }

  function place(x: number, y: number) {
    if (selected === null || me === undefined) return;

    if (selected.kind === "blank") {
      // A full square takes nothing: no point asking what the blank stands
      // for when it cannot land.
      if (isFull(x, y)) {
        refuse(`That square is full — ${STACK_CAP} tiles is the limit.`);
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

  /** The rack's swap button asks first: the swap is once a game. */
  function toggleSwap() {
    setSwapping((current) => !current);
    setPassing(false);
  }

  /** Pressing Pass asks first: one tap should not cost a turn by accident. */
  function togglePass() {
    setPassing((current) => !current);
    if (!passing) {
      setPending([]);
      setSelected(null);
      setBlankAt(null);
      setSwapping(false);
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

  async function confirmSwap() {
    setError(null);
    try {
      // The whole rack goes, so anything staged comes back first: its letters
      // are about to be somebody else's draw.
      setPending([]);
      setSelected(null);
      setBlankAt(null);
      await swapTiles({ gameId });
      setSwapping(false);
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
    setQuitting(warning);
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
  const nameOf = new Map(
    view.players.map((p) => [p.userId, p.userId === view.viewerUserId ? "you" : p.name]),
  );

  const turns = history ?? [];
  // Fresh review starts at the end: the board you were just looking at.
  const step = stepAt ?? turns.length;
  const ready = reviewing && history !== undefined;
  // Live tiles until the history has actually arrived: swapping in an empty
  // board while it loads reads as the game having been wiped, which is the
  // one thing a review must never look like.

  const shown = ready ? boardAfter(turns, step) : (replayBoard ?? view.tiles);

  /*
   * Your draft belongs to the live board, not to one being replayed or
   * reviewed: its tiles, the outlines saying whether its words check out, the
   * blank waiting for a letter and its score all stand down until the live
   * board is back, since they point at squares that board has yet to reach.
   */
  const showDraft = !reviewing && !recapActive;
  const lastTurn = step > 0 ? turns[step - 1] : undefined;

  /*
   * Scores as they stood at this point in the review, so they count up with
   * the board instead of sitting at the final total from the first frame.
   *
   * The last frame keeps the real scores rather than computed ones. It used
   * to have to: the ending handed whoever went out what everyone else was
   * still holding, and that swing was not a turn, so counting turns alone
   * stopped a few points short. Going out settles nothing now (§6), so the
   * two agree -- this reads the stored scores because they are the authority,
   * not because the sum would come up short.
   */
  const reviewScores =
    ready && step < turns.length ? scoresAfter(turns, step) : null;

  /*
   * What this play scores. A play that is not legal scores nothing, whatever
   * its words and squares would have added up to. Drawn in the play panel, and
   * over the board on a small screen, where the panel is a scroll away.
   */
  const scoreBadge = preview && (
    <span
      className={[
        styles.previewScore,
        legality?.ok === true ? "" : styles.previewNothing,
        legality !== null && !legality.ok ? styles.previewInvalid : "",
      ].join(" ")}
    >
      {legality?.ok === true ? preview.total : 0}
    </span>
  );

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        {/* Above the board rather than floating over it: this one stands for
            the whole round, so it must not cover a square somebody is aiming
            at, and it must not disappear the way the refusal does. */}
        {playingOut && !reviewing && (
          <div className={styles.finalRound} role="status" aria-live="polite">
            <strong className={styles.finalRoundTitle}>
              {meOut ? "You're out" : "The bag is empty"}
            </strong>
            <span>
              {meOut
                ? "Nothing left to play. The game ends when everyone is out, or a full round passes with nobody playing."
                : "Play out your tiles. The game ends when everyone is out, or a full round passes with nobody playing."}
            </span>
          </div>
        )}

        {/* The refusal floats over the board, so the board is what it is
            measured against. */}
        <div
          className={styles.boardArea}
          onPointerDownCapture={recapActive ? skipRecap : undefined}
        >
          <Board
            boardSize={game.boardSize}
            layout={view.layout}
            tiles={shown}
            pending={showDraft ? pending : []}
            seatOf={seatOf}
            nameOf={nameOf}
            yourSeat={view.yourSeat}
            /* Not gated on the turn: a play can be laid out and priced while
               you wait, which is when there is time to think about it.
               Playing it is what needs the turn -- the Play button stays off,
               and the server would refuse it anyway. */
            canPlace={!reviewing && selected !== null && !choosingBlank}
            onPlace={place}
            onPickUp={pickUp}
            awaitingBlankAt={showDraft ? blankAt : null}
            goodCells={showDraft ? wordCells.good : undefined}
            badCells={showDraft ? wordCells.bad : undefined}
            // The points step lays nothing new, so it rings nothing: ringing
            // the whole play replayed the first spot's rings a second time.
            recentCells={noteSpot?.total === true ? undefined : noteSpot?.cells}
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

          {/* The play's score in the board's corner, for a phone: the panel
              that says so in full sits below the board there. Hidden from
              screen readers, which get the same number from the panel. */}
          {scoreBadge && showDraft && (
            <div className={styles.boardTally} aria-hidden="true">
              {scoreBadge}
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

        {/*
          Who just played, what it made and what it scored. It takes the
          rack's place rather than floating over the board: nobody is playing
          while a play is being shown, and a card over the board covered the
          very squares it was pointing at. The rack stays underneath, hidden,
          so the page does not jump when the card comes and goes.
        */}
        {(() => {
          const rackShown = me?.letters != null && game.status !== "finished" && !reviewing;
          const announcing = noteTurn !== undefined;
          const card = announcing && (
            <div
              // One element for the whole run of steps, not one per step: it
              // stays up from one play to the next and changes colour between
              // players, rather than vanishing and fading back in each time.
              className={[styles.announce, rackShown ? styles.announceOverRack : ""].join(" ")}
              data-seat={seatOf.get(noteTurn.userId)}
              role="status"
              aria-live="polite"
              // A catch-up replay never stands between you and your turn.
              onPointerDown={recapActive ? skipRecap : undefined}
            >
              <button
                type="button"
                className={styles.announceClose}
                aria-label="Skip the replay"
                title="Skip"
                // Its own press, not the card's, which only cuts a catch-up short.
                onPointerDown={(e) => e.stopPropagation()}
                onClick={skipAll}
              >
                ×
              </button>
              {/* A machine's level is noise here; the scoreboard still says it. */}
              <span className={styles.announceName}>{withoutLevel(noteTurn.name)}</span>
              {noteSpot !== undefined && !noteSpot.total && noteSpot.words.length > 0 && (
                <span className={styles.recapWords}>{noteSpot.words.join(", ")}</span>
              )}
              {/* The points are their own last step, once every spot is down. */}
              {(noteSpot === undefined || noteSpot.total) && (
                <span className={styles.recapPoints}>+{noteTurn.score}</span>
              )}
            </div>
          );
          if (!rackShown || !me?.letters) return card;
          return (
            <div className={styles.rackSlot}>
              <div className={announcing ? styles.rackHidden : undefined} inert={announcing}>
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
                onSwap={toggleSwap}
                // Once a game, and only while the bag has something to swap with.
                canSwap={myTurn && !me.swapped && view.tilesLeft > 0}
                swapping={swapping}
                onPass={togglePass}
                canPass={myTurn}
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
              </div>
              {card}
            </div>
          );
        })()}

        {blankAt !== null && (
          // Pressing away takes the blank back, which is what the button
          // under the letters used to say in words.
          <Modal onDismiss={() => setBlankAt(null)} label="Choose a letter for the blank">
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
          </Modal>
        )}

        {quitting !== null && (
          <Modal onDismiss={() => setQuitting(null)} label="Quit this game">
            <p className={styles.quitWarning}>{quitting}</p>
            <div className={styles.quitActions}>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setQuitting(null)}
              >
                Keep playing
              </button>
              <button
                type="button"
                className={styles.quitConfirm}
                onClick={() => {
                  setQuitting(null);
                  void resignGame({ gameId }).then(onLeave);
                }}
              >
                Quit
              </button>
            </div>
          </Modal>
        )}

        {view.seatsFilled < game.playerCount && (
          <div className={styles.waiting}>
            {/* Name who has not arrived: "2 of 3 seats filled" says how many
                are missing, never which. */}
            <strong>Waiting for players.</strong> {view.seatsFilled} of{" "}
            {game.playerCount} seats filled
            {invitees.length > 0 && <> — yet to accept: {invitees.join(", ")}</>}
            {game.status === "lobby" ? (
              // Offered to strangers: nobody has agreed to anything yet, so
              // the game waits for the table to fill before it begins.
              <>. Nobody can place tiles until the game is full.</>
            ) : view.turnHeld ? (
              // Among friends the game is already under way, and has come
              // round to a seat nobody is in.
              <>. The turn is waiting for whoever takes the next seat.</>
            ) : (
              <>. The game is under way — play carries on as seats fill.</>
            )}
            {view.canJoin && viewer?.isGuest === true ? (
              // A guest cannot hold a seat: the mutation refuses it, and being
              // told why here beats pressing a button that says no.
              <> Playing with people needs an account — make one from the menu.</>
            ) : view.canJoin ? (
              <>
                {" "}
                Pick your colour:{" "}
                <SeatPicker
                  totalSeats={GAME.maxPlayers}
                  takenSeats={view.players.map((p) => p.seat)}
                  value={joinSeatChoice}
                  onChange={(seat) => {
                    setJoinSeatChoice(seat);
                    setError(null);
                    joinGame({ gameId, seat }).catch((e: unknown) => {
                      // Somebody may have just taken it -- back to picking
                      // rather than showing a seat that didn't take.
                      setJoinSeatChoice(null);
                      setError(userMessage(e));
                    });
                  }}
                />
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
              Pass your turn? A full round of passes ends the game.
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

        {swapping && myTurn && (
          <div className={styles.tradeBar}>
            <span>
              Swap all your letters for new ones? You get one swap a game, and
              you still play this turn.
            </span>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => setSwapping(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() => void confirmSwap()}
            >
              Swap
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
          tilesLeft={view.tilesLeft}
          unseen={view.unseen}
          bagSize={BAG_SIZE}
            status={game.status}
          /*
           * Asking somebody to be friends sits beside their name, for as long
           * as the game does: an invitation gathers people who may never have
           * met, and it cannot introduce them to each other. Nothing is shown
           * at a game with strangers -- the query says nothing about those.
           */
          friendStates={friendStates}
          onInvite={(userId) => {
            void inviteFriend({
              gameId,
              userId: userId as Id<"users">,
            }).catch((err: unknown) => refuse(userMessage(err)));
          }}
        />

        {/*
          Only once it is over. Mid-game the board in front of you is the one
          that matters, and winding back through it while a turn is owed is a
          way to lose your place rather than find it.
        */}
        {game.status === "finished" && game.turnNumber > 0 && !reviewing && (
          <>
            <button
              type="button"
              className={styles.reviewOpen}
              onClick={() => setReviewing(true)}
            >
              Review turns
            </button>

            {/*
              The same table over again: same people, same colours, same
              machines. It is under way the moment it is asked for, on the
              seat of whoever asked -- so this button is the first turn of
              the new game as much as it is the end of the old one.

              Only with somebody else to play: against machines alone,
              starting a fresh game from the lobby is the same thing.
            */}
            {view.players.some((p) => !p.isBot && p.userId !== view.viewerUserId) && (
              <button
                type="button"
                className={[styles.reviewOpen, styles.playAgain].join(" ")}
                onClick={() => {
                  void rematch({ gameId })
                    .then((again) => onOpen(again.gameId))
                    .catch((err: unknown) => refuse(userMessage(err)));
                }}
              >
                Play again
              </button>
            )}
          </>
        )}

        {/*
          Everything here comes from the placement itself — the words, their
          points, the squares, the total — so it is all drawn the moment a tile
          lands. Only whether a word is a word waits on the server, and that
          changes a chip's colour rather than whether it is there. Swapping the
          whole panel for "checking…" and back was what made the page jump on
          every tile.
        */}
        {game.hints === true && (
          <HintPanel
            canAsk={myTurn}
            result={shownHint(hint.result, game.turnNumber)}
            active={game.status === "active"}
            loading={hint.loading}
            error={hint.error}
            onAsk={() => void ask()}
            onPick={pick}
          />
        )}

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
                      // Only once it counts: a chip still being checked, or one
                      // that turns out not to be a word, has nothing doubled.
                      scored.bonus !== undefined && valid === true && !unplayable
                        ? styles.doubled
                        : "",
                    ].join(" ")}
                  >
                    {scored.word}
                    {/* The multiplier the square applied, said rather than
                        left to be inferred from a number that looks too big.
                        x4 when the play crossed two of them. */}
                    {scored.bonus !== undefined && valid === true && !unplayable && (
                      <span className={styles.doubleMark}>×{scored.bonus}</span>
                    )}
                    {/* The long-word bonus is flat and turn-wide (see the
                        summary line below), not baked into this word's own
                        points -- so it gets the same kind of said-not-inferred
                        badge the multiplier does, just with a plus instead of
                        a times, on whichever word actually reached the length
                        that earned it. */}
                    {scored.long &&
                      valid === true &&
                      !unplayable && (
                        <span className={styles.longMark}>
                          +{LONG_WORD_BONUS}
                        </span>
                      )}
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

            {preview && preview.longWordBonus > 0 && (
              <p className={styles.scoreLine}>
                Long words:{" "}
                <span className={styles.previewScore}>+{preview.longWordBonus}</span>
              </p>
            )}

            {preview && (
              <p className={styles.scoreLine}>
                This play scores{" "}
                {/* The line stays put whether the play is legal or not: it is
                    the panel changing height that made the page jump. */}
                {scoreBadge}
              </p>
            )}

            {leftOpen > 0 && (
              <p className={styles.warning}>Leaves a 3×3 one tile short for the next player.</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
