import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { makeBoard } from "../../shared/engine/board";
import { applyPlacements } from "../../shared/engine/legality";
import { scoreTurn, type Placement } from "../../shared/engine/score";
import { Board } from "./Board";
import styles from "./Game.module.css";
import { Rack, type Selection } from "./Rack";
import { Scoreboard } from "./Scoreboard";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** A staged placement, plus which rack slot it came from. */
interface Staged extends Placement {
  from: Selection;
}

export function Game({ gameId }: { gameId: Id<"games"> }) {
  const view = useQuery(api.games.getGame, { gameId });
  const placeTiles = useMutation(api.games.placeTiles);
  const joinGame = useMutation(api.games.joinGame);
  const [copied, setCopied] = useState(false);

  const [pending, setPending] = useState<Staged[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [blankLetter, setBlankLetter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Live pointer drag: the tile that follows the finger/cursor. */
  const [drag, setDrag] = useState<{ letter: string; x: number; y: number } | null>(null);
  const dragRef = useRef<{ moved: boolean } | null>(null);

  const me = view?.players.find((p) => p.letters !== null);

  const preview = useMemo(() => {
    if (!view || pending.length === 0) return null;
    const before = makeBoard(view.tiles);
    const placements: Placement[] = pending.map(({ x, y, letter, isBlank }) => ({
      x,
      y,
      letter,
      isBlank,
    }));
    return scoreTurn(applyPlacements(before, placements), placements);
  }, [view, pending]);

  // Kept in a ref so the pointer listeners below can call the current
  // `place` without re-subscribing on every mouse move.
  const placeRef = useRef<(x: number, y: number) => void>(() => {});
  placeRef.current = (x, y) => place(x, y);

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
      if (cx !== undefined && cy !== undefined) placeRef.current(cx, cy);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging]);

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
  function grab(selection: Selection, event: ReactPointerEvent) {
    if (!myTurn || me === undefined) return;

    const letter =
      selection.kind === "blank" ? "?" : (me.letters?.[selection.index] ?? "");

    dragRef.current = { moved: false };
    setDrag({ letter, x: event.clientX, y: event.clientY });
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
          canPlace={myTurn && selected !== null && !choosingBlank}
          onPlace={place}
          onPickUp={pickUp}
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
                onClick={() => setBlankLetter(letter)}
              >
                {letter}
              </button>
            ))}
          </div>
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
            disabled={!myTurn || pending.length === 0 || submitting}
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

          {preview && (
            <span className={styles.preview}>
              This play scores <span className={styles.previewScore}>{preview.total}</span>
              {preview.squares.length > 0 &&
                ` · squares ${preview.squares.map((k) => `${k}×${k}`).join(", ")}`}
            </span>
          )}

          {game.status === "active" && !myTurn && (
            <span className={styles.preview}>Waiting for seat {game.currentSeat + 1}</span>
          )}
          {game.status === "lobby" && (
            <span className={styles.preview}>
              Waiting for players · {view.players.length} of {game.playerCount} seats
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
