import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { makeBoard } from "../../shared/engine/board";
import { makeDictionary } from "../../shared/engine/dictionary";
import { applyPlacements, validateTurn, wordsFormed } from "../../shared/engine/legality";
import { scoreTurn, type Placement } from "../../shared/engine/score";
import { Board } from "./Board";
import styles from "./Game.module.css";
import { Rack, type Selection } from "./Rack";
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

export function Game({ gameId }: { gameId: Id<"games"> }) {
  const view = useQuery(api.games.getGame, { gameId });
  const placeTiles = useMutation(api.games.placeTiles);
  const joinGame = useMutation(api.games.joinGame);
  const resignGame = useMutation(api.games.resignGame);
  const [copied, setCopied] = useState(false);

  const [pending, setPending] = useState<Staged[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [blankLetter, setBlankLetter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Live pointer drag: the tile that follows the finger/cursor. */
  const [drag, setDrag] = useState<{
    letter: string;
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

  const turnNumber = view?.game.turnNumber;

  // Load the draft for this turn, and drop it when the turn moves on.
  useEffect(() => {
    if (turnNumber === undefined) return;
    setPending(readDraft(gameId, turnNumber));
    setSelected(null);
    setBlankLetter(null);
  }, [gameId, turnNumber]);

  useEffect(() => {
    if (turnNumber === undefined) return;
    writeDraft(gameId, turnNumber, pending);
  }, [gameId, turnNumber, pending]);

  // Kept in a ref so the pointer listeners below can call the current
  // `place` without re-subscribing on every mouse move.
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
    };

    const onUp = (e: PointerEvent) => {
      const moved = dragRef.current?.moved ?? false;
      const origin = drag?.origin;
      dragRef.current = null;
      setDrag(null);

      // A press without movement is a selection, not a drag: leave the tile
      // selected so tap-then-tap still works.
      if (!moved) return;

      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest("[data-cell]");
      const cell = target?.getAttribute("data-cell");
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

  const seatOf = (userId: string) =>
    view.players.find((p) => p.userId === userId)?.seat ?? 0;

  const spentIndices = pending
    .filter((p) => p.from.kind === "letter")
    .map((p) => (p.from as { kind: "letter"; index: number }).index);
  const blankSpent = pending.some((p) => p.from.kind === "blank");

  /**
   * Pointer-based dragging, deliberately not HTML5 drag-and-drop: `draggable`
   * on a form control never fires `dragstart` in Firefox or Safari, and drag
   * events do not exist on touch at all. Pointer events behave identically for
   * mouse, trackpad and finger.
   */
  function startDrag(letter: string, origin: Origin, event: ReactPointerEvent) {
    dragRef.current = { moved: false };
    setDrag({ letter, x: event.clientX, y: event.clientY, origin });
  }

  /** Drag a letter out of the rack. */
  function grab(selection: Selection, event: ReactPointerEvent) {
    if (!myTurn || me === undefined) return;

    // A blank has no letter until one is chosen, so dragging it straight from
    // the rack would carry nothing; the alphabet tiles are the drag source.
    if (selection.kind === "blank") return;

    const letter = me.letters?.[selection.index];
    if (letter === undefined) return;

    startDrag(letter, { kind: "rack", selection }, event);
  }

  /** Drag straight off the alphabet picker, carrying the chosen letter. */
  function grabBlankLetter(letter: string, event: ReactPointerEvent) {
    if (!myTurn) return;
    setSelected({ kind: "blank" });
    setBlankLetter(letter);
    startDrag(letter, { kind: "rack", selection: { kind: "blank" } }, event);
  }

  /** Drag a tile already staged this turn to a different square. */
  function grabStaged(x: number, y: number, event: ReactPointerEvent) {
    const tile = pending.find((p) => p.x === x && p.y === y);
    if (tile === undefined) return;
    startDrag(tile.letter, { kind: "cell", x, y }, event);
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
      if (blankLetter === null) return; // still choosing which letter it stands for
      setPending((p) => [
        ...p,
        { x, y, letter: blankLetter, isBlank: true, from: { kind: "blank" } },
      ]);
      setBlankLetter(null);
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
    setBlankLetter(null);
    setError(null);
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
      // Convex wraps server errors; show the message the mutation threw.
      const message = e instanceof Error ? e.message : String(e);
      setError(message.replace(/^.*Error:\s*/s, "").split("\n")[0]!);
    } finally {
      setSubmitting(false);
    }
  }

  const choosingBlank = selected?.kind === "blank" && blankLetter === null;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <Board
          boardSize={game.boardSize}
          tiles={view.tiles}
          pending={pending}
          seatOf={seatOf}
          showOwnership={game.playerCount > 1}
          canPlace={myTurn && selected !== null && !choosingBlank}
          onPlace={place}
          onPickUp={pickUp}
          onGrabStaged={myTurn ? grabStaged : undefined}
        />

        {me?.letters && (
          <Rack
            letters={me.letters}
            blank={me.blank}
            spent={spentIndices}
            blankSpent={blankSpent}
            selected={selected}
            onSelect={(s) => {
              setSelected(s);
              setBlankLetter(null);
            }}
            onGrab={grab}
          />
        )}

        {choosingBlank && (
          <div className={styles.blankPicker}>
            <p className={styles.blankPrompt}>
              Which letter does the blank stand for?
            </p>
            {ALPHABET.map((letter) => (
              <button
                key={letter}
                type="button"
                className={styles.blankLetter}
                onPointerDown={(e) => grabBlankLetter(letter, e)}
                onClick={(e) => {
                  // Keyboard activation has no pointerdown to piggyback on.
                  if (e.detail === 0) setBlankLetter(letter);
                }}
              >
                {letter}
              </button>
            ))}
          </div>
        )}

        {game.status === "lobby" && (
          <div className={styles.waiting}>
            <strong>Waiting for players.</strong> {view.players.length} of{" "}
            {game.playerCount} seats filled — nobody can place tiles until the
            game is full. Send someone the invite link below.
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
          <button
            type="button"
            className={styles.secondary}
            disabled={pending.length === 0}
            onClick={clear}
          >
            Clear
          </button>

          {preview && legality?.ok && (
            <span className={styles.preview}>
              This play scores <span className={styles.previewScore}>{preview.total}</span>
              {preview.squares.length > 0 &&
                ` · squares ${preview.squares.map((k) => `${k}×${k}`).join(", ")}`}
            </span>
          )}

          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              void navigator.clipboard.writeText(window.location.href).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? "Link copied" : "Copy invite link"}
          </button>

          {game.status !== "finished" && view.yourSeat !== null && (
            <button
              type="button"
              className={styles.quit}
              onClick={() => {
                const others = game.playerCount > 1;
                const warning = others
                  ? "Quit this game? The other player wins it."
                  : "Quit this game?";
                if (window.confirm(warning)) void resignGame({ gameId });
              }}
            >
              Quit
            </button>
          )}

          {view.canJoin && (
            <button
              type="button"
              className={styles.button}
              onClick={() => void joinGame({ gameId })}
            >
              Join this game
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

        {drag && (
          <div
            className={styles.dragTile}
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
