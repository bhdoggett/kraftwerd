import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { BAG_SIZE, BOARD_SIZE, LAYOUT, PLAYER_SEAT, SCRIPT, SEAT_NAMES } from "../../tutorial/script";
import {
  checkPlacement,
  factsFor,
  loadFullDictionary,
  rackAt,
  seatId,
  standingsAfter,
  tilesAfter,
  tutorialDictionary,
  type Feedback,
} from "../../tutorial/model";
import {
  BLANK_HINT,
  CALLOUTS,
  CLOSING,
  INTRO,
  LEARNED,
  OFFER,
  QUIPS,
  REPLAY_NOTE,
  scoreHint,
  welcomeBack,
} from "../../tutorial/coach";
import { describeFeedback } from "../../tutorial/feedback";
import { markTutorialStarted } from "../../tutorial/seen";
import { forgetTurn, recordStats, savedTurn, saveTurn } from "../../tutorial/progress";
import { IDLE_MS, LEAD_MS, SHOW_MS } from "../../tutorial/pace";
import { buzz, playChime, playClick, setSoundOn, soundOn } from "../../tutorial/sound";
import { boardShapeNamed } from "../../../shared/boards";
import { cellKey, makeBoard } from "../../../shared/engine/board";
import { applyPlacements, validateTurn, wordsFormed } from "../../../shared/engine/legality";
import { scoreTurn, type Placement } from "../../../shared/engine/score";
import { markCells } from "../../lib/boardFeedback";
import { stageAt } from "../../lib/staging";
import { Board } from "../Board/Board";
import { Rack, type Selection } from "../Rack/Rack";
import { Scoreboard } from "../Scoreboard/Scoreboard";
import { Modal } from "../Modal/Modal";
import { headline } from "../GameOver/headline";
import { changesNothing, useTileStaging } from "../Game/useTileStaging";
import { PlayPanel, ScoreBadge } from "../Game/PlayPanel";
import { TurnCard } from "../Game/TurnCard";
import { BlankPicker } from "../Game/BlankPicker";
import { Bubble } from "./Bubble";
import { FlyUp } from "./FlyUp";
import { GhostHand } from "./GhostHand";
import { Hud } from "./Hud";
import styles from "./Tutorial.module.css";

interface TutorialProps {
  onLeave: () => void;
  onNewGame: () => void;
}

/**
 * - intro: the first screen's one line, until the first tap.
 * - watch: an opponent's turn: a short pause, then the move lands whole on
 *   the game's turn card, words and points together.
 * - place: the player's turn, tiles still to lay on their ghosts.
 * - shown: this turn's move is down and its callouts are up, one at a time.
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

/** The player's turns, in order: the progress dots count these. */
const PLAYER_TURNS = SCRIPT.flatMap((t, i) => (t.seat === PLAYER_SEAT ? [i] : []));
/** The player's first turn. */
const FIRST_PLAYER_TURN = PLAYER_TURNS[0];
/** The player's first turn with a blank to lay. */
const FIRST_BLANK_TURN = SCRIPT.findIndex((t) => t.seat === PLAYER_SEAT && t.placements.some((p) => p.isBlank));

const phaseFor = (turn: number): Phase =>
  turn >= TOTAL ? "over" : SCRIPT[turn].seat === PLAYER_SEAT ? "place" : "watch";

/** What comes after `turn`, for the last callout's button. */
function nextLabel(turn: number): string {
  const next = SCRIPT[turn + 1];
  if (next === undefined) return "See the scores";
  return next.seat === PLAYER_SEAT ? "Next: your move" : `Next: ${SEAT_NAMES[next.seat]}'s turn`;
}

/**
 * The recorded game, turn by turn, with the player making their own moves:
 * the board, rack, play panel and scores of a real game, other players'
 * moves landing whole on the game's turn card, and a short line over the
 * board when a move shows something new. Where the player left off is kept
 * on this device, so a return can pick up there.
 */
export function Tutorial({ onLeave, onNewGame }: TutorialProps) {
  const [turn, setTurn] = useState(0);
  const [phase, setPhase] = useState<Phase>("intro");
  /** Where a returning player left off, offered on the first screen. */
  const [resume, setResume] = useState<number | null>(() => savedTurn());
  /** Play pressed too early: what is wrong, and the square it is about. */
  const [error, setError] = useState<{ text: string; cell: string | null; ring: boolean } | null>(null);
  /** A drop the rules refuse, said over the board for a moment, as in a game. */
  const [refusal, setRefusal] = useState<string | null>(null);
  /** On an opponent's turn, whether their move has landed yet. */
  const [landed, setLanded] = useState(false);
  /** Whether this turn's replay note has been read. */
  const [noteRead, setNoteRead] = useState(false);
  /** Whether the first turn's blank hint has been put away. */
  const [blankHintRead, setBlankHintRead] = useState(false);
  /** Whether the first turn's note on the play panel has been put away. */
  const [scoreHintRead, setScoreHintRead] = useState(false);
  /** After a move, which of its callouts is up: they come one at a time. */
  const [callout, setCallout] = useState(0);
  /** Presses of Play before the move was right, this turn. */
  const [earlyPlays, setEarlyPlays] = useState(0);
  /** Whether the drag is being shown (first turn, or after two early presses). */
  const [hand, setHand] = useState(false);
  /** The turn and staged-tile count at which the player last went idle. */
  const [idleAt, setIdleAt] = useState<string | null>(null);
  const [sound, setSound] = useState(() => soundOn());

  useEffect(() => {
    markTutorialStarted();
    recordStats((s) => ({ ...s, opened: s.opened + 1 }));
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
  /** An opponent's move, landed and on the turn card. */
  const showing = phase === "watch" && landed && step !== undefined;
  /** The first stack by another player holds their turn until it is read. */
  const noting = showing && !noteRead && turn === REPLAY_NOTE.turn;

  /** How many turns are on the board (and in the scores). */
  const done = phase === "shown" || showing ? turn + 1 : Math.min(turn, TOTAL);
  const movesDone = PLAYER_TURNS.filter((t) => t < done).length;

  // The whole hand, as the record says it stood: it refills the moment a
  // move goes down.
  const rack = useMemo(() => rackAt(done), [done]);

  /** The board as it stood before this turn's move. */
  const before = useMemo(() => makeBoard(tilesAfter(turn)), [turn]);

  const staging = useTileStaging({
    letters: rack.letters,
    blanks: rack.blanks,
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

  /** The ghosts no tile is on yet. */
  const open = placing ? step.placements.filter((g) => !pending.some((p) => p.x === g.x && p.y === g.y)) : [];

  /** The letter the picker points out: the ghost's under the blank, or else the blank's own. */
  const wantedLetter = (() => {
    if (blankAt === null || !placing) return undefined;
    const at = step.placements.find((g) => g.x === blankAt.x && g.y === blankAt.y);
    if (at !== undefined) return at.letter;
    return (open.find((g) => g.isBlank) ?? open[0])?.letter;
  })();

  const placements: Placement[] = useMemo(
    () => (placing ? pending.map(({ x, y, letter, isBlank }) => ({ x, y, letter, isBlank })) : []),
    [placing, pending],
  );
  const staged = placements.length > 0;
  const feedback: Feedback | null = placing ? checkPlacement(turn, placements) : null;

  // A soft click as each tile lands (when sound is on).
  const stagedCount = useRef(0);
  useEffect(() => {
    if (pending.length > stagedCount.current) playClick();
    stagedCount.current = pending.length;
  }, [pending.length]);

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

  const tiles = useMemo(() => tilesAfter(done), [done]);
  const standings = standingsAfter(done);
  const facts = useMemo(() => (step !== undefined && phase === "shown" ? factsFor(turn) : null), [step, phase, turn]);
  const mineShown = phase === "shown" && step?.seat === PLAYER_SEAT;

  /** The big moment of the player's move, if it had one: a 3×3, or going out. */
  const flyUp = (() => {
    if (!mineShown || facts === null) return null;
    if (facts.newSquares.length > 0) return { cell: facts.newSquares[4], text: `+${facts.score.squarePoints}` };
    if (standingsAfter(turn + 1).seats[PLAYER_SEAT].out) {
      const lastTile = step.placements[step.placements.length - 1];
      return { cell: cellKey(lastTile.x, lastTile.y), text: "Out!" };
    }
    return null;
  })();

  // The opponent's move as it lands, ringed as a game rings a play.
  const recentCells = useMemo(
    () => (showing ? new Set(step.placements.map((p) => cellKey(p.x, p.y))) : undefined),
    [showing, step],
  );
  // While staging, the word rings a game draws; once the player's move is
  // down, the 3×3 it closed, outlined.
  const goodCells = useMemo(() => {
    if (staged) return wordCells?.good;
    return mineShown && facts !== null && facts.newSquares.length > 0 ? new Set(facts.newSquares) : undefined;
  }, [staged, wordCells, mineShown, facts]);
  const badCells = useMemo(() => {
    const bad = new Set(wordCells?.bad ?? []);
    if (error?.ring && error.cell !== null) bad.add(error.cell);
    return bad.size > 0 ? bad : undefined;
  }, [wordCells, error]);

  // --- hints on the player's turn ---

  /** The blank still has a ghost to go to: the pair pulse white together. */
  const blankWanted = open.some((g) => g.isBlank);
  /**
   * The first blank, pointed out where it waits in the rack, until a tap:
   * once a couple of tiles are down (the drag comes first), and never once a
   * blank is on the board.
   */
  const blankHintShown =
    placing &&
    turn === FIRST_BLANK_TURN &&
    blankWanted &&
    pending.length >= 2 &&
    !pending.some((p) => p.isBlank) &&
    blankAt === null &&
    !blankHintRead;
  /** On the first turn, once every tile is right and before Play: what the play panel is for. */
  const scoreHintShown = placing && turn === FIRST_PLAYER_TURN && feedback?.kind === "ready" && !scoreHintRead;

  // Sitting still on a turn for a while brings a wordless nudge: the next
  // ghost lit and its tile wiggling.
  const idleKey = `${turn}:${pending.length}`;
  useEffect(() => {
    if (!placing || open.length === 0) return;
    const t = setTimeout(() => setIdleAt(idleKey), IDLE_MS);
    return () => clearTimeout(t);
  }, [placing, idleKey, open.length]);
  const nudgeGhost = placing && idleAt === idleKey ? open[0] : undefined;
  const nudgeCell = nudgeGhost === undefined ? null : cellKey(nudgeGhost.x, nudgeGhost.y);
  const nudgeTile: Selection | null = (() => {
    if (nudgeGhost === undefined) return null;
    if (nudgeGhost.isBlank) return { kind: "blank" };
    const index = rack.letters.findIndex((l, i) => l === nudgeGhost.letter && !staging.spentIndices.includes(i));
    return index >= 0 ? { kind: "letter", index } : null;
  })();

  /** The ghost the drag demo goes to. */
  const handGhost = placing && hand && blankAt === null ? open[0] : undefined;

  // --- moving the game along ---

  /** The current callout, or the offer to skip that follows the third move's. */
  const callouts = step !== undefined ? CALLOUTS[turn] : [];
  const offering = phase === "shown" && turn === OFFER.turn && callout === callouts.length;
  const shownCallout = phase === "shown" ? callouts[callout] : undefined;

  /** The squares the tutorial is talking about right now, lit on the board. */
  const spotCells = (() => {
    const cells = new Set<string>();
    if (shownCallout !== undefined) cells.add(shownCallout.cell);
    if (noting) cells.add(REPLAY_NOTE.cell);
    if (error?.cell != null) cells.add(error.cell);
    if (nudgeCell !== null) cells.add(nudgeCell);
    return cells.size > 0 ? cells : undefined;
  })();

  function goTo(n: number) {
    staging.recallAll();
    setError(null);
    setLanded(false);
    setNoteRead(false);
    setCallout(0);
    setEarlyPlays(0);
    setHand(n === FIRST_PLAYER_TURN);
    setTurn(n);
    setPhase(phaseFor(n));
    recordStats((s) => ({ ...s, furthest: Math.max(s.furthest, n) }));
    if (n >= TOTAL) {
      forgetTurn();
      recordStats((s) => ({ ...s, finished: s.finished + 1 }));
    } else if (phaseFor(n) === "place" && n > FIRST_PLAYER_TURN) {
      saveTurn(n);
    }
  }

  const advance = () => goTo(turn + 1);

  /** This turn's move is down: point out what is new, or move straight on. */
  function moveDown() {
    if (callouts.length > 0) setPhase("shown");
    else advance();
  }

  function skipToEnd() {
    staging.recallAll();
    setTurn(TOTAL);
    setPhase("over");
    forgetTurn();
    recordStats((s) => ({ ...s, skipped: s.skipped + 1 }));
  }

  // An opponent's move lands after a short pause and is shown a moment;
  // with nothing to point out the next turn follows, so their turns chain.
  // The first stack holds until its note is read.
  const stepOn = useEffectEvent(() => {
    if (!landed) setLanded(true);
    else moveDown();
  });
  useEffect(() => {
    if (phase !== "watch" || noting) return;
    const t = setTimeout(stepOn, landed ? SHOW_MS : LEAD_MS);
    return () => clearTimeout(t);
  }, [phase, turn, landed, noting]);

  /** Set when a press on the rack already counted as the tap, so its click does not count again. */
  const pressCounted = useRef(false);

  // A tap anywhere, or the start of a drag from the rack, takes down the
  // intro, a callout or a hint and lets the game go on; during an opponent's
  // turn it hurries their move along, but stops on the stack note if it has
  // not been read. A tap is a click, so a finger scrolling the page takes
  // nothing down; a button with its own job (Skip, the sound switch) is left
  // to do it.
  /** A tap, while the tutorial waits for one: what it moves on. */
  const tap = useEffectEvent(() => {
    if (phase === "intro") {
      if (resume !== null) goTo(resume);
      else setPhase("watch");
    } else if (noting) setNoteRead(true);
    else if (phase === "watch" && !landed) setLanded(true);
    else if (phase === "watch") moveDown();
    else if (phase === "shown" && callout + 1 < callouts.length) setCallout(callout + 1);
    else if (phase === "shown" && turn === OFFER.turn && callout + 1 === callouts.length) setCallout(callout + 1);
    else if (phase === "shown") advance();
    else if (blankHintShown) setBlankHintRead(true);
    else if (scoreHintShown) setScoreHintRead(true);
  });
  const waitsForTap = phase === "intro" || phase === "shown" || phase === "watch" || blankHintShown || scoreHintShown;
  useEffect(() => {
    if (!waitsForTap) return;
    // A press counted before this listener was up says nothing about the next click.
    pressCounted.current = false;
    const ownAction = (e: Event) => e.target instanceof Element && e.target.closest("[data-own-action]") !== null;
    const press = (e: PointerEvent) => {
      // Every click starts with a press, so this is where a stale mark is cleared.
      pressCounted.current = e.target instanceof Element && e.target.closest("[data-rack]") !== null;
      if (pressCounted.current) tap();
    };
    const click = (e: MouseEvent) => {
      if (pressCounted.current) pressCounted.current = false;
      else if (!ownAction(e)) tap();
    };
    const key = (e: KeyboardEvent) => {
      // A focused control answers Enter and Space with a click of its own.
      const onControl = e.target instanceof Element && e.target.closest("button, a, input, select, textarea") !== null;
      if (e.key === "Escape" || ((e.key === "Enter" || e.key === " ") && !onControl)) tap();
    };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [waitsForTap]);

  function play() {
    if (!placing || feedback === null) return;
    // The note on the play panel is read first: this press only puts it away.
    if (scoreHintShown) return;
    if (feedback.kind !== "ready") {
      const at =
        feedback.kind === "offGhost" || feedback.kind === "wrongLetter"
          ? cellKey(feedback.x, feedback.y)
          : open[0] === undefined
            ? null
            : cellKey(open[0].x, open[0].y);
      setError({ text: describeFeedback(feedback), cell: at, ring: feedback.kind !== "missing" });
      // A second early press: show the drag again.
      if (earlyPlays + 1 >= 2) setHand(true);
      setEarlyPlays(earlyPlays + 1);
      return;
    }
    const big = factsFor(turn).newSquares.length > 0 || standingsAfter(turn + 1).seats[PLAYER_SEAT].out;
    playChime(big);
    if (big) buzz();
    staging.recallAll();
    setError(null);
    setHand(false);
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
            spotCells={spotCells}
            ghosts={ghosts}
            onGrabStaged={placing ? staging.grabStaged : undefined}
          />

          <Hud
            done={movesDone}
            total={PLAYER_TURNS.length}
            sound={sound}
            onSound={() => {
              setSoundOn(!sound);
              setSound(!sound);
              if (!sound) playClick();
            }}
          />

          {phase === "intro" &&
            (resume === null ? (
              <Bubble cell={null} text={INTRO} dismissable dismissLabel="Let's play" />
            ) : (
              <Bubble
                cell={null}
                text={welcomeBack(PLAYER_TURNS.indexOf(resume) + 1, PLAYER_TURNS.length)}
                dismissable
                dismissLabel="Continue"
                secondary={{
                  label: "Start over",
                  onClick: () => {
                    forgetTurn();
                    setResume(null);
                    setPhase("watch");
                  },
                }}
              />
            ))}
          {noting && (
            <Bubble cell={REPLAY_NOTE.cell} text={REPLAY_NOTE.text} prefer={REPLAY_NOTE.side} dismissable />
          )}
          {shownCallout !== undefined && (
            <Bubble
              key={`${turn}-${callout}`}
              cell={shownCallout.cell}
              text={shownCallout.text}
              prefer={shownCallout.side ?? "above"}
              dismissable
              dismissLabel={callout === callouts.length - 1 && turn !== OFFER.turn ? nextLabel(turn) : "Got it"}
            />
          )}
          {offering && (
            <Bubble
              cell={null}
              text={OFFER.text}
              dismissable
              dismissLabel="Keep playing"
              secondary={{ label: "Skip to the end", onClick: skipToEnd }}
            />
          )}
          {flyUp !== null && <FlyUp key={`fly-${turn}`} cell={flyUp.cell} text={flyUp.text} />}
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
        <div className={styles.rackSlot} onPointerDownCapture={() => setHand(false)}>
          <div className={showing ? styles.rackHidden : undefined} inert={showing}>
            <Rack
              seat={PLAYER_SEAT}
              letters={rack.letters}
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
              nudge={nudgeTile}
            />
          </div>
          {blankHintShown && (
            <Bubble cell={null} anchor="[data-face=blank]" text={BLANK_HINT} prefer="above" dismissable />
          )}
          {showing && (
            <TurnCard
              name={SEAT_NAMES[step.seat]}
              seat={step.seat}
              words={step.words}
              points={step.score}
              quip={QUIPS[turn]}
              overRack
              // The press that reached it has already moved things on: see
              // the tap listener above.
              onSkip={() => {}}
            />
          )}
        </div>

        {blankAt !== null && placing && (
          <BlankPicker onPick={nameBlank} onDismiss={() => setBlankAt(null)} suggest={wantedLetter} />
        )}

        {handGhost !== undefined && (
          <GhostHand letter={handGhost.letter} isBlank={handGhost.isBlank} cell={cellKey(handGhost.x, handGhost.y)} />
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
          <div
            className={[styles.playSlot, scoreHintShown ? styles.playLit : ""].join(" ")}
            data-lit={scoreHintShown ? "" : undefined}
          >
            <PlayPanel score={preview} checked={checked} legality={legality} leftOpen={0} scoreBadge={scoreBadge} />
            {/* Above the panel, where a phone can see it: over the rack, and
                so over Play, which waits for Got it anyway. */}
            {scoreHintShown && preview !== null && (
              <Bubble cell={null} anchor="section" text={scoreHint(preview.total)} prefer="above" dismissable />
            )}
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
            <p className={styles.learnedTitle}>You learned:</p>
            <ul className={styles.learned} aria-label="You learned">
              {LEARNED.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className={styles.endActions}>
              <button type="button" className={styles.endSecondary} onClick={onLeave}>
                Back to lobby
              </button>
              <button type="button" className={styles.endButton} onClick={onNewGame}>
                Play a real game
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
