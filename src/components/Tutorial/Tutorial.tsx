import { useEffect, useMemo, useRef, useState } from "react";
import { BAG_SIZE, BOARD_SIZE, LAYOUT, PLAYER_SEAT, SCRIPT, SEAT_NAMES } from "../../tutorial/script";
import {
  checkPlacement,
  factsFor,
  HISTORY,
  rackAt,
  replaySteps,
  seatId,
  standingsAfter,
  tilesAfter,
  loadFullDictionary,
  tutorialDictionary,
  type Feedback,
} from "../../tutorial/model";
import { BLANK_HINT, CALLOUTS, CLOSING, INTRO, REPLAY_NOTE } from "../../tutorial/coach";
import { describeFeedback } from "../../tutorial/feedback";
import { markTutorialStarted } from "../../tutorial/seen";
import { boardShapeNamed } from "../../../shared/boards";
import { cellKey, makeBoard } from "../../../shared/engine/board";
import { applyPlacements, validateTurn, wordsFormed } from "../../../shared/engine/legality";
import { scoreTurn, type Placement } from "../../../shared/engine/score";
import { markCells } from "../../lib/boardFeedback";
import { boardAfter } from "../../lib/replay";
import { stageAt } from "../../lib/staging";
import { Board } from "../Board/Board";
import { Rack } from "../Rack/Rack";
import { Scoreboard } from "../Scoreboard/Scoreboard";
import { Modal } from "../Modal/Modal";
import { headline } from "../GameOver/headline";
import { changesNothing, useTileStaging } from "../Game/useTileStaging";
import { PlayPanel, ScoreBadge } from "../Game/PlayPanel";
import { TurnCard } from "../Game/TurnCard";
import { BlankPicker } from "../Game/BlankPicker";
import { RECAP_LEAD_MS, RECAP_PLAY_MS, RECAP_POINTS_MS } from "../Game/replayTiming";
import { Bubble } from "./Bubble";
import styles from "./Tutorial.module.css";

interface TutorialProps {
  onLeave: () => void;
  onNewGame: () => void;
}

/**
 * - intro: the first screen's one line, until the first tap.
 * - watch: an opponent's turn, replayed as a game replays a play landing:
 *   a pause, then a spot at a time on the turn card, then its points.
 * - place: the player's turn, tiles still to lay on their ghosts.
 * - shown: this turn's move is down and its callouts are up, until a tap.
 * - over: past the last turn, the game-over dialog is up.
 */
type Phase = "intro" | "watch" | "place" | "shown" | "over";

/** How long a refused drop is said for, as in a game. */
const REFUSAL_MS = 2600;

const TOTAL = SCRIPT.length;
const SEATS = [0, 1, 2] as const;
const seatOf: ReadonlyMap<string, number> = new Map(SEATS.map((s) => [seatId(s), s]));
const nameOf: ReadonlyMap<string, string> = new Map(SEATS.map((s) => [seatId(s), SEAT_NAMES[s]]));
const shape = boardShapeNamed(LAYOUT, BOARD_SIZE);

/** The player's first turn with a blank to lay. */
const FIRST_BLANK_TURN = SCRIPT.findIndex((t) => t.seat === PLAYER_SEAT && t.placements.some((p) => p.isBlank));

const phaseFor = (turn: number): Phase =>
  turn >= TOTAL ? "over" : SCRIPT[turn].seat === PLAYER_SEAT ? "place" : "watch";

/**
 * The recorded game, turn by turn, with the player making their own moves:
 * the board, rack, play panel and scores of a real game, a short line over
 * the board when a move shows something new, and nothing saved anywhere.
 * Every open starts at turn one.
 */
export function Tutorial({ onLeave, onNewGame }: TutorialProps) {
  const [turn, setTurn] = useState(0);
  const [phase, setPhase] = useState<Phase>("intro");
  /** Play pressed too early: what is wrong, and the square it is about. */
  const [error, setError] = useState<{ text: string; cell: string | null; ring: boolean } | null>(null);
  /** A drop the rules refuse, said over the board for a moment, as in a game. */
  const [refusal, setRefusal] = useState<string | null>(null);
  /** On an opponent's turn, the replay step on screen: -1 is the pause before it. */
  const [spot, setSpot] = useState(-1);
  /** Whether this turn's replay note has been read. */
  const [noteRead, setNoteRead] = useState(false);
  /** Whether the first turn's blank hint has been put away. */
  const [blankHintRead, setBlankHintRead] = useState(false);

  useEffect(() => {
    markTutorialStarted();
  }, []);

  /** The words staged tiles are checked against: a short list until the full one loads. */
  const [dictionary, setDictionary] = useState(() => tutorialDictionary);
  useEffect(() => {
    let live = true;
    loadFullDictionary()
      .then((d) => {
        if (live) setDictionary(() => d);
      })
      // Offline, the short list stands in.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (refusal === null) return;
    const t = setTimeout(() => setRefusal(null), REFUSAL_MS);
    return () => clearTimeout(t);
  }, [refusal]);

  const step = turn < TOTAL ? SCRIPT[turn] : undefined;
  const placing = phase === "place" && step !== undefined;
  const ghosts = placing ? step.placements : [];

  const steps = useMemo(() => (phase === "watch" ? replaySteps(turn) : []), [phase, turn]);
  const shownStep = phase === "watch" && spot >= 0 ? steps[spot] : undefined;
  /** The replay stops on the first stack by another player until it is read. */
  const noting =
    !noteRead &&
    turn === REPLAY_NOTE.turn &&
    shownStep !== undefined &&
    !shownStep.total &&
    shownStep.cells.has(REPLAY_NOTE.cell);

  /** How many turns are on the board (and in the scores). */
  const done = phase === "shown" || shownStep?.total === true ? turn + 1 : Math.min(turn, TOTAL);
  /** The latest move on the board, if any. */
  const last = done - 1;

  // The whole hand, as the record says it stood: it refills the moment a
  // move goes down.
  const hand = useMemo(() => rackAt(done), [done]);

  /** The board as it stood before this turn's move. */
  const before = useMemo(() => makeBoard(tilesAfter(turn)), [turn]);

  const staging = useTileStaging({
    letters: hand.letters,
    blanks: hand.blanks,
    before,
    canPlace: placing,
    // Asked, as in a game: the picker opens with the wanted letter lit.
    nameBlank: () => null,
    refuse: (why) => setRefusal(why),
    clearError: () => setError(null),
  });
  const { pending, blankAt, setBlankAt } = staging;

  /** The blank's letter, as the game's own picker stages it. */
  function nameBlank(letter: string) {
    if (blankAt === null) return;
    if (changesNothing(before, blankAt.x, blankAt.y, letter)) {
      setRefusal(`That square is already ${letter} — a tile has to change it.`);
      setBlankAt(null);
      return;
    }
    staging.setPending((current) =>
      stageAt(current, { x: blankAt.x, y: blankAt.y, letter, isBlank: true, from: { kind: "blank" } }),
    );
    setBlankAt(null);
  }

  /** The letter the picker points out: the ghost's under the blank, or else the blank's own. */
  const wantedLetter = (() => {
    if (blankAt === null || !placing) return undefined;
    const at = step.placements.find((g) => g.x === blankAt.x && g.y === blankAt.y);
    if (at !== undefined) return at.letter;
    const open = step.placements.filter((g) => !pending.some((p) => p.x === g.x && p.y === g.y));
    return (open.find((g) => g.isBlank) ?? open[0])?.letter;
  })();

  const placements: Placement[] = useMemo(
    () => (placing ? pending.map(({ x, y, letter, isBlank }) => ({ x, y, letter, isBlank })) : []),
    [placing, pending],
  );
  const staged = placements.length > 0;
  const feedback: Feedback | null = placing ? checkPlacement(turn, placements) : null;

  // --- what a game works out from a staged play, worked out the same way ---

  const boards = useMemo(
    () => (staged ? { before, after: applyPlacements(before, placements) } : null),
    [staged, before, placements],
  );
  const preview = useMemo(
    () => (boards === null ? null : scoreTurn(boards.after, placements, { before, bonusSquares: shape.bonusSquares })),
    [boards, placements, before],
  );
  /** Each word's verdict, from the device's own list rather than the server. */
  const checked = useMemo(
    () =>
      boards === null
        ? undefined
        : [...new Set(wordsFormed(boards.after, placements))].map((word) => ({
            word,
            valid: dictionary.has(word),
          })),
    [boards, placements, dictionary],
  );
  const wordCells = useMemo(
    () =>
      boards === null || checked === undefined
        ? null
        : markCells(boards, placements, new Map(checked.map((e) => [e.word, e.valid]))),
    [boards, placements, checked],
  );
  const legality = useMemo(
    () =>
      boards === null
        ? null
        : validateTurn(boards.before, placements, dictionary, {
            width: BOARD_SIZE,
            height: BOARD_SIZE,
            blocked: shape.blocked,
            centre: shape.centre,
          }),
    [boards, placements, dictionary],
  );

  // --- the latest move, once it is down ---

  // Partway through a replayed play, only the spots shown so far are down.
  const tiles = useMemo(
    () => (shownStep !== undefined && !shownStep.total ? boardAfter(HISTORY, turn, shownStep.upTo) : tilesAfter(done)),
    [shownStep, turn, done],
  );
  const standings = standingsAfter(done);
  const lastFacts = useMemo(() => (last >= 0 ? factsFor(last) : null), [last]);
  const mineShown = phase === "shown" && SCRIPT[turn].seat === PLAYER_SEAT;

  // The spot being replayed, ringed as a game rings it; the points step lays
  // nothing new, so it rings nothing.
  const recentCells = shownStep !== undefined && !shownStep.total ? shownStep.cells : undefined;
  // While staging, the word rings a game draws; once the player's move is
  // down, the 3×3 it closed, outlined.
  const goodCells = useMemo(() => {
    if (staged) return wordCells?.good;
    return mineShown && lastFacts !== null && lastFacts.newSquares.length > 0 ? new Set(lastFacts.newSquares) : undefined;
  }, [staged, wordCells, mineShown, lastFacts]);
  const badCells = useMemo(() => {
    const bad = new Set(wordCells?.bad ?? []);
    if (error?.ring && error.cell !== null) bad.add(error.cell);
    return bad.size > 0 ? bad : undefined;
  }, [wordCells, error]);

  // --- moving the game along ---

  function advance() {
    const n = turn + 1;
    staging.recallAll();
    setError(null);
    setSpot(-1);
    setNoteRead(false);
    setTurn(n);
    setPhase(phaseFor(n));
  }

  /** This turn's move is down: point out what is new, or move straight on. */
  function moveDown() {
    if (CALLOUTS[turn].length > 0) setPhase("shown");
    else advance();
  }

  // An opponent's move is replayed at a game's pace, a spot at a time; with
  // nothing to point out afterwards the next turn follows at once, so their
  // turns chain.
  useEffect(() => {
    if (phase !== "watch" || noting) return;
    const ms = spot < 0 ? RECAP_LEAD_MS : steps[spot]?.total ? RECAP_POINTS_MS : RECAP_PLAY_MS;
    const t = setTimeout(() => {
      if (spot + 1 < steps.length) setSpot(spot + 1);
      else moveDown();
    }, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the step it is for
  }, [phase, turn, spot, steps, noting]);

  /** Set when a press on the rack already counted as the tap, so its click does not count again. */
  const pressCounted = useRef(false);

  // A tap anywhere, or the start of a drag from the rack, takes down the
  // intro or the callouts and lets the game go on; during a replay it skips
  // the rest of it, as the turn card's × does (or, on the replay's note,
  // takes the note down and lets the replay go on). A tap is a click, so a finger
  // scrolling the page takes nothing down.
  useEffect(() => {
    if (phase !== "intro" && phase !== "shown" && phase !== "watch") return;
    const tap = () => {
      if (phase === "intro") setPhase("watch");
      else if (noting) setNoteRead(true);
      else if (phase === "watch") moveDown();
      else advance();
    };
    const press = (e: PointerEvent) => {
      // Every click starts with a press, so this is where a stale mark is cleared.
      pressCounted.current = e.target instanceof Element && e.target.closest("[data-rack]") !== null;
      if (pressCounted.current) tap();
    };
    const click = () => {
      if (pressCounted.current) pressCounted.current = false;
      else tap();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") tap();
    };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the turn it is for
  }, [phase, turn, noting]);

  function play() {
    if (!placing || feedback === null) return;
    if (feedback.kind !== "ready") {
      const unfilled = step.placements.find((g) => !placements.some((p) => p.x === g.x && p.y === g.y));
      const at =
        feedback.kind === "offGhost" || feedback.kind === "wrongLetter"
          ? cellKey(feedback.x, feedback.y)
          : unfilled === undefined
            ? null
            : cellKey(unfilled.x, unfilled.y);
      setError({ text: describeFeedback(feedback), cell: at, ring: feedback.kind !== "missing" });
      return;
    }
    staging.recallAll();
    setError(null);
    moveDown();
  }

  const finalScores = useMemo(
    () =>
      [...standingsAfter(TOTAL).seats]
        .sort((a, b) => b.score - a.score)
        .map((s) => ({ name: SEAT_NAMES[s.seat], score: s.score, you: s.seat === PLAYER_SEAT })),
    [],
  );
  const winner = finalScores[0];

  const scoreBadge = preview && <ScoreBadge score={preview} legality={legality} />;
  /** The blank still has a ghost to go to: the pair pulse white together. */
  const blankWanted =
    placing &&
    step.placements.some((g) => g.isBlank && !placements.some((p) => p.x === g.x && p.y === g.y));
  /** Points are explained in the play panel: lit up on the player's first turn. */
  const panelLit = turn === 1;
  /** Somebody else's play on the turn card, in the rack's place, as in a game. */
  const announcing = shownStep !== undefined && step !== undefined;

  const { drag } = staging;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <div className={styles.boardArea}>
          <Board
            boardSize={BOARD_SIZE}
            layout={LAYOUT}
            tiles={tiles}
            pending={placing ? pending : []}
            awaitingBlankAt={placing ? blankAt : null}
            seatOf={seatOf}
            nameOf={nameOf}
            yourSeat={PLAYER_SEAT}
            canPlace={placing && staging.selected !== null && blankAt === null}
            onPlace={staging.place}
            onPickUp={staging.pickUp}
            goodCells={goodCells}
            badCells={badCells}
            recentCells={recentCells}
            ghosts={ghosts}
            onGrabStaged={placing ? staging.grabStaged : undefined}
          />

          {phase === "intro" && <Bubble cell={null} text={INTRO} dismissable />}
          {noting && <Bubble cell={REPLAY_NOTE.cell} text={REPLAY_NOTE.text} dismissable />}
          {phase === "shown" &&
            CALLOUTS[turn].map((c, i, all) => (
              <Bubble
                key={`${turn}-${c.cell}`}
                cell={c.cell}
                text={c.text}
                prefer={c.side ?? (i === 0 ? "above" : "below")}
                dismissable={i === all.length - 1}
              />
            ))}
          {error !== null && placing && (
            <Bubble cell={error.cell} text={error.text} tone="error" dismissable onDismiss={() => setError(null)} />
          )}
          {refusal !== null && <div className={styles.refusal}>{refusal}</div>}

          {/* What the staged play scores, in the board's corner, as in a game. */}
          {scoreBadge && (
            <div className={styles.boardTally} aria-hidden="true">
              {scoreBadge}
            </div>
          )}
        </div>

        {/* The rack stays underneath the turn card, hidden, so nothing moves. */}
        <div className={styles.rackSlot}>
          <div className={announcing ? styles.rackHidden : undefined} inert={announcing}>
            <Rack
              seat={PLAYER_SEAT}
              letters={hand.letters}
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
              blankHint={blankWanted}
            />
          </div>
          {/* The first blank, pointed out where it waits in the rack. */}
          {blankWanted && turn === FIRST_BLANK_TURN && blankAt === null && !blankHintRead && (
            <Bubble
              cell={null}
              anchor="[data-face=blank]"
              text={BLANK_HINT}
              prefer="above"
              dismissable
              onDismiss={() => setBlankHintRead(true)}
            />
          )}
          {announcing && (
            <TurnCard
              name={SEAT_NAMES[step.seat]}
              seat={step.seat}
              words={shownStep.total ? undefined : shownStep.words}
              points={shownStep.total ? step.score : undefined}
              overRack
              // The press that reached it has already skipped the replay:
              // see the tap listener above.
              onSkip={() => {}}
            />
          )}
        </div>

        {blankAt !== null && placing && (
          <BlankPicker onPick={nameBlank} onDismiss={() => setBlankAt(null)} suggest={wantedLetter} />
        )}

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
          onQuit={phase === "over" ? undefined : onLeave}
          quitLabel="Leave tutorial"
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
          currentSeat={SCRIPT[done]?.seat ?? -1}
          tilesLeft={standings.bagLeft}
          unseen={{}}
          bagSize={BAG_SIZE}
          status={phase === "over" ? "finished" : "active"}
        />

        {/* The game's own play panel, while the player lays a play. */}
        {staged && (
          <div className={[styles.playSlot, panelLit ? styles.playLit : ""].join(" ")} data-lit={panelLit ? "" : undefined}>
            <PlayPanel score={preview} checked={checked} legality={legality} leftOpen={0} scoreBadge={scoreBadge} />
          </div>
        )}
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
