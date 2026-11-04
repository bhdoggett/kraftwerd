import { useEffect, useMemo, useRef, useState } from "react";
import { BAG_SIZE, BOARD_SIZE, LAYOUT, PLAYER_SEAT, SCRIPT, SEAT_NAMES } from "../../tutorial/script";
import { checkPlacement, factsFor, seatId, standingsAfter, tilesAfter, type Feedback } from "../../tutorial/model";
import { CLOSING, COACH, GAME_OVER_LINE } from "../../tutorial/coach";
import { markTutorialStarted } from "../../tutorial/seen";
import { cellKey, makeBoard } from "../../../shared/engine/board";
import type { Placement } from "../../../shared/engine/score";
import { Board } from "../Board/Board";
import { Rack } from "../Rack/Rack";
import { Scoreboard } from "../Scoreboard/Scoreboard";
import { Modal } from "../Modal/Modal";
import { headline } from "../GameOver/headline";
import { useTileStaging } from "../Game/useTileStaging";
import { CoachCard, describeFeedback } from "./CoachCard";
import styles from "./Tutorial.module.css";

interface TutorialProps {
  onLeave: () => void;
  onNewGame: () => void;
}

/**
 * - watch: an opponent's turn. The move goes down after a short pause.
 * - place: the player's turn, tiles still to lay on their ghosts.
 * - played: the player's move is down and scored.
 * - over: past the last turn, the game-over dialog is up.
 */
type Phase = "watch" | "place" | "played" | "over";

/** How long an opponent "thinks" before their move goes down. */
const OPPONENT_PAUSE_MS = 600;

const TOTAL = SCRIPT.length;
const SEATS = [0, 1, 2] as const;
const seatOf: ReadonlyMap<string, number> = new Map(SEATS.map((s) => [seatId(s), s]));
const nameOf: ReadonlyMap<string, string> = new Map(SEATS.map((s) => [seatId(s), SEAT_NAMES[s]]));

const phaseFor = (turn: number): Phase =>
  turn >= TOTAL ? "over" : SCRIPT[turn].seat === PLAYER_SEAT ? "place" : "watch";

const NO_LETTERS: readonly string[] = [];

/**
 * The recorded game, turn by turn, with the player making their own moves:
 * the board, rack and Play button of a real game, a coach card over the
 * board, and nothing saved anywhere. Every open starts at turn one.
 */
export function Tutorial({ onLeave, onNewGame }: TutorialProps) {
  const [turn, setTurn] = useState(0);
  const [phase, setPhase] = useState<Phase>(() => phaseFor(0));
  /** On a watch turn, whether the opponent's move is down yet. */
  const [revealed, setRevealed] = useState(false);
  /** What the coach card says instead, while something is wrong. */
  const [error, setError] = useState<{ text: string; cell?: { x: number; y: number } } | null>(null);

  useEffect(() => {
    markTutorialStarted();
  }, []);

  useEffect(() => {
    if (phase !== "watch" || revealed) return;
    const t = setTimeout(() => setRevealed(true), OPPONENT_PAUSE_MS);
    return () => clearTimeout(t);
  }, [phase, revealed, turn]);

  const step = SCRIPT[turn] as (typeof SCRIPT)[number] | undefined;
  const placing = phase === "place" && step !== undefined;
  const ghosts = placing ? step.placements : [];

  // Only this turn's tiles: the rest of the real rack was never recorded.
  const letters = useMemo(
    () => (placing ? step.placements.filter((p) => !p.isBlank).map((p) => p.letter) : NO_LETTERS),
    [placing, step],
  );
  const blanks = placing ? step.placements.filter((p) => p.isBlank).length : 0;

  /** The board as it stood before this turn's move. */
  const before = useMemo(() => makeBoard(tilesAfter(turn)), [turn]);

  /** Cells holding a staged tile, for nameBlank (which staging calls). */
  const filledRef = useRef<ReadonlySet<string>>(new Set());

  const staging = useTileStaging({
    letters,
    blanks,
    before,
    canPlace: placing,
    // A blank becomes the letter of whatever ghost it lands on, blank's or
    // not (a blank and a real tile of one letter score alike). Off every
    // ghost it takes the first unfilled ghost's letter, so it stages as a
    // tile the card can explain, and the letter picker never opens.
    nameBlank: (x, y) => {
      const at = ghosts.find((g) => g.x === x && g.y === y);
      if (at !== undefined) return at.letter;
      const filled = filledRef.current;
      return (ghosts.find((g) => !filled.has(cellKey(g.x, g.y))) ?? ghosts[0])?.letter ?? null;
    },
    refuse: (why) => setError({ text: why }),
    clearError: () => setError(null),
  });
  const { pending } = staging;
  useEffect(() => {
    filledRef.current = new Set(pending.map((p) => cellKey(p.x, p.y)));
  }, [pending]);

  const staged: Placement[] = useMemo(
    () => pending.map(({ x, y, letter, isBlank }) => ({ x, y, letter, isBlank })),
    [pending],
  );
  const feedback: Feedback | null = placing ? checkPlacement(turn, staged) : null;

  /** Whether this turn's move is on the board for good. */
  const moved = phase === "played" || (phase === "watch" && revealed) || phase === "over";
  const tiles = useMemo(() => tilesAfter(moved && phase !== "over" ? turn + 1 : turn), [moved, phase, turn]);
  const standings = standingsAfter(moved && phase !== "over" ? turn + 1 : turn);

  const facts = useMemo(() => (step !== undefined && moved ? factsFor(turn) : null), [step, moved, turn]);

  const recentCells = useMemo(
    () =>
      phase === "watch" && revealed && step !== undefined
        ? new Set(step.placements.map((p) => cellKey(p.x, p.y)))
        : undefined,
    [phase, revealed, step],
  );
  const goodCells = useMemo(
    () => (phase === "played" && facts !== null ? new Set(facts.newSquares) : undefined),
    [phase, facts],
  );
  const badCells = useMemo(
    () => (error?.cell === undefined ? undefined : new Set([cellKey(error.cell.x, error.cell.y)])),
    [error],
  );

  /** Bumped when Play is pressed early: the card, which on a short screen
      is scrolled off above the rack, scrolls into view to say why. */
  const [scrollSignal, setScrollSignal] = useState(0);

  function play() {
    if (!placing || feedback === null) return;
    if (feedback.kind !== "ready") {
      setError({
        text: describeFeedback(feedback),
        cell: feedback.kind === "offGhost" || feedback.kind === "wrongLetter" ? { x: feedback.x, y: feedback.y } : undefined,
      });
      setScrollSignal((n) => n + 1);
      return;
    }
    staging.recallAll();
    setError(null);
    setPhase("played");
  }

  function next() {
    const n = turn + 1;
    staging.recallAll();
    setError(null);
    setRevealed(false);
    setTurn(n);
    setPhase(phaseFor(n));
  }

  const card = (() => {
    if (phase === "over" || step === undefined) {
      return { heading: "Game over", text: GAME_OVER_LINE };
    }
    const coach = COACH[turn];
    if (phase === "place") {
      if (error !== null) return { heading: "Not yet", text: error.text, error: true };
      return { heading: "Your move", text: coach.before ?? "" };
    }
    if (phase === "played") {
      return { heading: `Nice: +${step.score}`, text: coach.after, breakdown: facts?.score, onNext: next };
    }
    const who = `${SEAT_NAMES[step.seat]}'s move`;
    if (!revealed) return { heading: who, text: `${SEAT_NAMES[step.seat]} is playing…` };
    return { heading: who, text: coach.after, breakdown: facts?.score, onNext: next };
  })();

  const finalScores = useMemo(
    () =>
      [...standingsAfter(TOTAL).seats]
        .sort((a, b) => b.score - a.score)
        .map((s) => ({ name: SEAT_NAMES[s.seat], score: s.score, you: s.seat === PLAYER_SEAT })),
    [],
  );
  const winner = finalScores[0];

  const { drag } = staging;

  return (
    <div className={styles.screen}>
      <div className={styles.main}>
        <CoachCard
          step={Math.min(turn + 1, TOTAL)}
          total={TOTAL}
          heading={card.heading}
          text={card.text}
          breakdown={card.breakdown}
          error={card.error}
          scrollSignal={scrollSignal}
          onNext={card.onNext}
          onLeave={onLeave}
        />

        <div className={styles.boardArea}>
          <Board
            boardSize={BOARD_SIZE}
            layout={LAYOUT}
            tiles={tiles}
            pending={placing ? pending : []}
            seatOf={seatOf}
            nameOf={nameOf}
            yourSeat={PLAYER_SEAT}
            canPlace={placing && staging.selected !== null}
            onPlace={staging.place}
            onPickUp={staging.pickUp}
            goodCells={goodCells}
            badCells={badCells}
            recentCells={recentCells}
            ghosts={ghosts}
            onGrabStaged={placing ? staging.grabStaged : undefined}
          />
        </div>

        <Rack
          seat={PLAYER_SEAT}
          letters={letters}
          spent={staging.spentIndices}
          blanks={staging.blanksLeft}
          selected={staging.selected}
          onSelect={staging.setSelected}
          onGrab={staging.grab}
          order={staging.rackOrder}
          previewOrder={staging.previewOrder}
          draggedIndex={staging.draggedLetterIndex}
          dragOverRack={staging.dragOverRack}
          onShuffle={staging.shuffle}
          onRecall={staging.recallAll}
          canRecall={pending.length > 0}
          // No swapping or passing here: every move is the recorded one.
          onSwap={() => {}}
          canSwap={false}
          swapping={false}
          onPass={() => {}}
          canPass={false}
          passing={false}
          onPlay={play}
          canPlay={feedback?.kind === "ready"}
          // Looks off until every ghost is filled, but answers a press by
          // saying what is still wrong.
          playAnswers={placing}
          playing={false}
        />

        {drag && (
          <div
            className={[styles.dragTile, drag.isBlank ? styles.dragBlank : ""].join(" ")}
            data-seat={PLAYER_SEAT % 4}
            style={{ left: drag.x, top: drag.y }}
            aria-hidden="true"
          >
            {drag.letter}
          </div>
        )}
      </div>

      <div className={styles.side}>
        <Scoreboard
          players={standings.seats.map((s) => ({
            userId: seatId(s.seat),
            seat: s.seat,
            score: s.score,
            name: SEAT_NAMES[s.seat],
            isYou: s.seat === PLAYER_SEAT,
            tilesInHand: s.tilesInHand,
            blanks: s.blanks,
          }))}
          // Once a move is down, the turn has passed to whoever is next.
          currentSeat={(moved && phase !== "over" ? SCRIPT[turn + 1] : step)?.seat ?? -1}
          tilesLeft={standings.bagLeft}
          unseen={{}}
          bagSize={BAG_SIZE}
          status={phase === "over" ? "finished" : "active"}
        />
      </div>

      {phase === "over" && (
        <Modal>
          <div className={styles.endBody}>
            <h2 className={styles.endTitle}>
              {headline({ youWon: winner.you, winners: winner.you ? [] : [winner.name] })}
            </h2>
            <ol className={styles.endScores}>
              {finalScores.map((row) => (
                <li key={row.name} className={row.you ? styles.endYou : undefined}>
                  <span>{row.name}</span>
                  <span className={styles.endScore}>{row.score}</span>
                </li>
              ))}
            </ol>
            <p className={styles.endClosing}>{CLOSING}</p>
            <div className={styles.endActions}>
              <button type="button" className={styles.endSecondary} onClick={onLeave}>
                Back to lobby
              </button>
              <button type="button" className={styles.endButton} onClick={onNewGame}>
                New game
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
