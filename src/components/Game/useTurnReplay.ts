import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cellKey } from "../../../shared/engine/board";
import {
  latestPlayByOthers,
  playsInHistorySinceYourTurn,
  playsSinceYourTurn,
  spotSteps,
} from "../../lib/recap";
import { boardAfter } from "../../lib/replay";

/**
 * How long each play in the recap is pointed out: the four pulses of
 * `recent-play` in Board.module.css. A second longer than it was, so the
 * words and points in the announcement can actually be read.
 */
const RECAP_PLAY_MS = 3200;

/**
 * How long a turn's points step lasts: a name and a number, so it needs far
 * less reading time than a spot's words.
 */
const RECAP_POINTS_MS = 1600;

/**
 * How long the replay holds the board as you left it before the first play
 * lands: long enough to register as the position you remember.
 */
const RECAP_LEAD_MS = 700;

type GameView = FunctionReturnType<typeof api.games.getGame>;

/**
 * Other players' plays, shown to you: the catch-up replay of what you missed
 * and the plays landing while you watch, each a spot at a time (`spotSteps`).
 *
 * Owns the turn history, which the review in Game.tsx reads too, and the two
 * clocks that step the replays along. What Game.tsx gets back is the board to
 * show in place of the live one (`board`, null for the live one), the cells to
 * ring, the card to show over the board, and how to cut a replay short.
 */
export function useTurnReplay({
  gameId,
  view,
  reviewing,
}: {
  gameId: Id<"games">;
  view: GameView | undefined;
  reviewing: boolean;
}) {
  /**
   * How far this turn's replay has got. Phase 0 is the board as you left it,
   * phase i is the board with the i-th play since then added, and past the
   * last play it is `done`. Kept rather than the boards themselves -- those are
   * worked out while rendering -- and keyed by the turn, so a new turn starts
   * again from phase 0 without anything having to reset it.
   */
  const [recapStep, setRecapStep] = useState<{
    turn: number;
    step: number;
    done: boolean;
  } | null>(null);

  /**
   * The turn the game was on when this page opened it. Plays from then on were
   * watched as they landed, so they are shown as they happen and never
   * replayed; only what came before is news to catch up on. Keyed by game,
   * since the page can move to another game without being made again, and set
   * while rendering so the first frame with a game already knows it.
   */
  const [openedAt, setOpenedAt] = useState<{ gameId: Id<"games">; turn: number } | null>(
    null,
  );
  if (view && openedAt?.gameId !== gameId) {
    setOpenedAt({ gameId, turn: view.game.turnNumber });
  }
  const openedAtTurn = openedAt?.gameId === gameId ? openedAt.turn : undefined;

  /** The newest play watched live that has had its moment. */
  const [liveShown, setLiveShown] = useState(-1);

  /** What was played while you were away, a play at a time, oldest first. */
  const playsSinceYou = useMemo(
    () =>
      view === undefined || view === null || openedAtTurn === undefined
        ? []
        : playsSinceYourTurn(view.tiles, view.viewerUserId).filter(
            (p) => p.turnNumber < openedAtTurn,
          ),
    [view, openedAtTurn],
  );

  /*
   * A play landing while you watch is shown as it lands -- the ring and the
   * card on the live board, no rewind -- rather than saved up for a replay.
   * Not your own: you know what you just played.
   */
  const latestTheirs = useMemo(
    () => (view ? latestPlayByOthers(view.tiles, view.viewerUserId) : null),
    [view],
  );
  const livePlay =
    !reviewing &&
    latestTheirs !== null &&
    openedAtTurn !== undefined &&
    latestTheirs.turnNumber >= openedAtTurn &&
    latestTheirs.turnNumber > liveShown
      ? latestTheirs
      : null;
  const liveTurn = livePlay?.turnNumber;

  /*
   * The board as it last stood with nothing landing on it. A play arriving
   * while you watch is held off until its first spot is ready, and this is
   * what is shown meanwhile: the board exactly as it was, stacked squares
   * still showing the letter underneath. Taking the play's squares off the
   * live board instead lost that letter, so a word blinked one short.
   */
  type ViewTiles = NonNullable<typeof view>["tiles"];
  const [settledTiles, setSettledTiles] = useState<ViewTiles | null>(null);
  if (view && livePlay === null && settledTiles !== view.tiles) {
    setSettledTiles(view.tiles);
  }

  /*
   * The replay is keyed by the moment the page opened, not by whose turn it
   * is. It used to wait for your turn, so a play made after yours -- at a
   * table of three, the next player's, while the third was still thinking --
   * went unseen until your turn came round. Now whatever you missed replays
   * as you arrive, once: plays from then on are watched as they land, so the
   * turn coming round to you has nothing new to replay.
   */
  const recapKey = openedAtTurn;
  const recapState =
    recapStep !== null && recapStep.turn === recapKey ? recapStep : null;
  const recapPhase = recapState?.step ?? 0;

  /*
   * Whether there is a replay to give. Shown once, as you arrive: a reminder
   * of what you missed belongs at that moment and nowhere after. At a table
   * of three that can be the play two turns back and then the one after it --
   * the board re-read in the order it was built.
   */
  const recapWanted =
    view?.game.status === "active" &&
    !reviewing &&
    playsSinceYou.length > 0 &&
    recapState?.done !== true;

  /*
   * The turn history, fetched while it is being reviewed and while a recap is
   * replaying what was played. Most visits need neither, so it is not fetched
   * the rest of the time.
   */
  const history = useQuery(
    api.games.listTurns,
    // Kept while the game is on, too: a play landing while you watch is
    // stepped through off the history, and waiting to fetch it then is what
    // let the whole play flash onto the board first.
    reviewing || recapWanted || livePlay !== null || view?.game.status === "active"
      ? { gameId }
      : "skip",
  );

  /*
   * The plays to replay, read off the history rather than the board: the board
   * only says who owns each square now, so a tile the next play built on would
   * count as that play's, and the play that laid it would land with no ring.
   */
  const viewerId = view?.viewerUserId;
  const replayPlays = useMemo(
    () =>
      history === undefined || viewerId === undefined || openedAtTurn === undefined
        ? null
        : playsInHistorySinceYourTurn(history, viewerId).filter(
            (p) => p.turnNumber < openedAtTurn,
          ),
    [history, viewerId, openedAtTurn],
  );

  /*
   * The same plays, a spot at a time: a turn laid in two parts of the board is
   * replayed as two steps, top to bottom and left to right, each naming the
   * words it made (`playSpots`). The card's points go with a turn's last spot,
   * since the history scores the turn as a whole.
   */
  const replaySteps = useMemo(
    () => (history === undefined || replayPlays === null ? null : spotSteps(history, replayPlays)),
    [history, replayPlays],
  );
  const replayCount = replaySteps?.length ?? 0;

  /*
   * The replay runs off the history, because rewinding a stacked square means
   * knowing the tile that was under it -- so it starts once the history is
   * here, rather than on a board it cannot rebuild. Until then the board holds
   * at the rewound position it can work out without it.
   */
  const recapLoading = recapWanted && history === undefined;
  const recapping = recapWanted && replayCount > 0;
  /** Whether the board on screen is anything but the live one. */
  const recapActive = recapLoading || recapping;

  /** The spot being added right now: none before the first, none after the last. */
  const recapPlay =
    recapping && recapPhase > 0 ? replaySteps?.[recapPhase - 1] : undefined;

  /** That play in words: who made it, what it spelled and what it scored. */
  const recapTurn =
    recapPlay === undefined
      ? undefined
      : history?.find((t) => t.turnNumber === recapPlay.turnNumber);

  /*
   * A play landing while you watch goes a spot at a time as well, off the
   * history once it arrives. Until then it lights up whole, as it always did.
   */
  const liveSteps = useMemo(
    () =>
      history === undefined || livePlay === null
        ? null
        : spotSteps(history, [livePlay]),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the turn, not the object
    [history, liveTurn],
  );
  const [liveStep, setLiveStep] = useState<{ turn: number; index: number } | null>(null);
  const liveIndex = liveStep !== null && liveStep.turn === liveTurn ? liveStep.index : 0;
  const liveSpot = liveSteps?.[liveIndex];
  const liveSpotCount = liveSteps?.length ?? 0;
  const liveSpotIsTotal = liveSpot?.total === true;

  // Each spot gets a play's length; after the last, the play has had its moment.
  // A newer play landing sooner replaces it.
  useEffect(() => {
    // The clock starts with the first spot on screen, not before it.
    if (liveTurn === undefined || liveSpotCount === 0) return;
    const next = setTimeout(
      () => {
        if (liveIndex + 1 < liveSpotCount) setLiveStep({ turn: liveTurn, index: liveIndex + 1 });
        else setLiveShown(liveTurn);
      },
      liveSpotIsTotal ? RECAP_POINTS_MS : RECAP_PLAY_MS,
    );
    return () => clearTimeout(next);
  }, [liveTurn, liveIndex, liveSpotCount, liveSpotIsTotal]);

  /** The spot the card over the board speaks for: replayed, or just watched. */
  const noteSpot = recapPlay ?? liveSpot;

  /** What the card over the board speaks for: the play being replayed, or the one just watched. */
  const noteTurn =
    recapTurn ??
    (livePlay === null
      ? undefined
      : history?.find((t) => t.turnNumber === livePlay.turnNumber));

  // All the timer does is move the replay on a phase, and past the last, end it.
  useEffect(() => {
    if (!recapping || recapKey === undefined) return;
    const next = setTimeout(
      () =>
        setRecapStep({
          turn: recapKey,
          step: recapPhase + 1,
          done: recapPhase >= replayCount,
        }),
      recapPhase === 0 ? RECAP_LEAD_MS : recapPlay?.total ? RECAP_POINTS_MS : RECAP_PLAY_MS,
    );
    return () => clearTimeout(next);
  }, [recapping, recapKey, recapPhase, replayCount, recapPlay?.total]);

  /** Any press on the board ends the replay: it must never stand between you and your turn. */
  const skipRecap = () => {
    if (recapKey !== undefined) setRecapStep({ turn: recapKey, step: 0, done: true });
  };

  /*
   * The board the replay is showing: as it stood before the first play since
   * your turn, then with each play added in order. Rebuilt from the history
   * the way a review is, which is what gives a stacked square back the tile
   * it had before.
   */
  const turns = history ?? [];
  const recapFrom = recapPlay ?? replaySteps?.[0];
  const recapBoard =
    !recapping || recapFrom === undefined
      ? null
      : recapPlay === undefined
        ? boardAfter(turns, recapFrom.at)
        : boardAfter(turns, recapPlay.at, recapPlay.upTo);
  /*
   * A live play shows a spot at a time too. Until its first spot is ready the
   * board stays as it was before the play, rather than showing the whole play
   * and then taking it away again: off the history when that is here but has
   * not caught up with the play, and otherwise the live board without the
   * play's squares.
   */
  const liveBoard =
    livePlay === null || reviewing || recapActive
      ? null
      : liveSpot !== undefined
        ? boardAfter(turns, liveSpot.at, liveSpot.upTo)
        : (settledTiles ??
          (view?.tiles ?? []).filter((t) => !livePlay.cells.has(cellKey(t.x, t.y))));

  /*
   * Until the history arrives, the replay's opening board is the live one with
   * the plays since your turn taken off. It cannot give a stacked square back
   * the tile it had -- only the history knows that -- but it means a refresh
   * never shows the finished board first and then takes the plays away.
   */
  const recapCells = recapLoading
      ? new Set(playsSinceYou.flatMap((p) => [...p.cells]))
      : null;
  const heldBack =
    recapCells === null || view == null
      ? null
      : view.tiles.filter((t) => !recapCells.has(cellKey(t.x, t.y)));

  return {
    history,
    /** The board to show instead of the live one, or null to show the live one. */
    board: recapBoard ?? liveBoard ?? heldBack,
    /** Whether a catch-up replay has the board, so the draft stands down. */
    recapActive,
    skipRecap,
    /** The spot being pointed out, and the turn it belongs to. */
    noteSpot,
    noteTurn,
  };
}
