import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CreateGame } from "../CreateGame/CreateGame";
import { GuestGame } from "../GuestGame/GuestGame";
import { DevTools } from "../DevTools/DevTools";
import { NewGame } from "../NewGame/NewGame";
import { drawNames } from "../../../shared/names";
import {
  claimPromisedGame,
  useStartGame,
  type BotSeat,
} from "../../lib/useStartGame";
import { userMessage } from "../../lib/errors";
import styles from "./Lobby.module.css";

export function Lobby({ onOpen }: { onOpen: (gameId: Id<"games">) => void }) {
  const mine = useQuery(api.games.listMyGames);
  const respondToInvite = useMutation(api.games.respondToInvite);
  const openGames = useQuery(api.games.listOpenGames);
  const joinGame = useMutation(api.games.joinGame);
  const [joinError, setJoinError] = useState<string | null>(null);

  const myGames = mine?.games ?? [];
  const invitations = mine?.invitations ?? [];
  const past = mine?.past ?? [];
  const [showPast, setShowPast] = useState(false);
  /**
   * Collapsed on every visit, and shown even when there is nothing in it.
   *
   * A section that only appeared once a seat happened to be open used to
   * mean most visitors never saw it and never learned strangers' games were
   * something you could browse at all. Always there, closed by default, so
   * the heading itself is what teaches the feature -- opening it is opt-in,
   * but knowing it exists is not.
   */
  const [openGamesExpanded, setOpenGamesExpanded] = useState(false);
  /** Shown in the heading, so the count is there before the section is open. */
  const openCount = openGames?.games.length ?? 0;
  /** The game just created, still choosing who fills its seats. */
  const [setup, setSetup] = useState<{
    gameId: Id<"games">;
    name: string;
    playerCount: number;
    /** How many friends were asked as the game was made. */
    invited: number;
  } | null>(null);

  const viewer = useQuery(api.users.viewer);
  const [creating, setCreating] = useState(false);
  const { start, starting, error: startError, clearError } = useStartGame();

  /**
   * A game whose every seat is spoken for opens straight away — solo, or one
   * where friends and machines between them fill the table. Only a game with
   * a seat still empty goes on to the link step, which is what that step is
   * for.
   */
  async function startGame(
    playerCount: number,
    friendIds: Id<"users">[],
    bots: BotSeat[],
    isPublic = false,
  ) {
    const game = await start(playerCount, friendIds, bots, isPublic);
    if (game === null) return;

    setCreating(false);
    const taken = 1 + friendIds.length + bots.length;
    if (taken === playerCount) onOpen(game.gameId);
    else setSetup({ ...game, invited: friendIds.length + bots.length });
  }

  /** Take a seat at a game somebody left open. */
  async function joinOpen(gameId: Id<"games">) {
    // A failed attempt's message belongs to that attempt, not the session --
    // clear it before trying again so a retry never sits under stale text.
    setJoinError(null);
    try {
      await joinGame({ gameId });
      onOpen(gameId);
    } catch (err) {
      setJoinError(userMessage(err));
    }
  }

  /*
   * The game a guest was promised on the way in.
   *
   * Made here rather than beside the button that promised it: signing in
   * swaps the whole tree, so that button is gone before there is an account
   * to make a game with.
   */
  const promised = useRef(false);
  useEffect(() => {
    if (promised.current) return;
    const kind = claimPromisedGame();
    if (kind === null) return;
    promised.current = true;
    // Out of the effect body, since making the game sets state as it goes.
    queueMicrotask(() =>
      kind === "solo"
        ? void startGame(1, [], [])
        : void startGame(
            2,
            [],
            [{ level: "medium", name: drawNames(1, Math.random)[0] }],
          ),
    );
    // Once, on arrival: startGame changes on every render, and this is not a
    // thing to redo when it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.lobby}>
      {setup && (
        <NewGame
          gameId={setup.gameId}
          name={setup.name}
          playerCount={setup.playerCount}
          invitedAlready={setup.invited}
          onOpen={(id) => {
            setSetup(null);
            onOpen(id);
          }}
          onClose={() => setSetup(null)}
        />
      )}

      <DevTools />

      <button
        type="button"
        className={styles.newGame}
        onClick={() => setCreating(true)}
      >
        New game
      </button>

      {creating &&
        (viewer?.isGuest === true ? (
          <GuestGame
            onStart={(playerCount, bots) =>
              void startGame(playerCount, [], bots)
            }
            onCancel={() => {
              setCreating(false);
              clearError();
            }}
            starting={starting}
            error={startError}
          />
        ) : (
          <CreateGame
            onStart={(playerCount, friendIds, bots, isPublic) =>
              void startGame(playerCount, friendIds, bots, isPublic)
            }
            onCancel={() => {
              setCreating(false);
              clearError();
            }}
            starting={starting}
            error={startError}
          />
        ))}

      {invitations.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.heading}>Invitations</h2>
          {invitations.map((g) => (
            <div key={g.gameId} className={styles.row}>
              <span className={styles.grow}>
                {g.invitedBy} invited you to {g.name}
                <br />
                <span className={styles.meta}>{g.playerCount} players</span>
              </span>
              <button
                type="button"
                className={styles.button}
                onClick={() =>
                  void respondToInvite({ gameId: g.gameId, accept: true })
                }
              >
                Accept
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() =>
                  void respondToInvite({ gameId: g.gameId, accept: false })
                }
              >
                Decline
              </button>
            </div>
          ))}
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.heading}>Your games</h2>
        {mine === undefined && <p className={styles.empty}>Loading…</p>}
        {mine && myGames.length === 0 && (
          <p className={styles.empty}>No games yet.</p>
        )}
        {myGames.map((g) => (
          <div key={g.gameId} className={styles.row}>
            <span className={styles.grow}>
              {g.name}
              <br />
              <span className={styles.meta}>
                {g.opponents.length === 0
                  ? "solo"
                  : g.opponents
                      .map((o) => (o.pending ? `${o.name} (invited)` : o.name))
                      .join(", ")}
                {" · "}
                {g.status === "lobby"
                  ? "waiting for players"
                  : `${g.yourScore} pts`}
                {/* Whose move it is, by name — the row said so only when the
                    answer was you, which is the case you least need told. */}
                {g.waitingFor !== null && !g.yourTurn && (
                  <>
                    {" "}
                    {" · "} waiting for {g.waitingFor}
                  </>
                )}
              </span>
            </span>
            {g.yourTurn && <span className={styles.badge}>Your turn</span>}
            <button
              type="button"
              className={styles.button}
              onClick={() => onOpen(g.gameId)}
            >
              Open
            </button>
          </div>
        ))}
      </section>

      {/*
        Below Your games, not above: an invitation is somebody waiting on an
        answer from you, and your own games are what brought you to the
        lobby in the first place. Browsing a stranger's open seat is the
        least urgent thing on this page, so it sits under both.

        Hidden from a guest entirely, the way CreateGame is: `joinGame`
        refuses guests, so every Join button here would answer "Make an
        account to play with other people". A section that teaches a feature
        is worth showing to somebody who could use it; a list of doors that
        are all locked is worse than no list, so a guest is shown neither
        the heading nor the buttons.
      */}
      {viewer?.isGuest !== true && (
        <section className={styles.section}>
          <button
            type="button"
            className={styles.openGamesToggle}
            aria-expanded={openGamesExpanded}
            onClick={() => setOpenGamesExpanded((open) => !open)}
          >
            {openGamesExpanded ? "▾" : "▸"} Open games ({openCount})
          </button>

          {openGamesExpanded && (
            <>
              {/*
                Games nobody you know made. The people at them are named as
                this viewer may see them -- an alias for a stranger, a name
                for a friend -- which is decided on the server, not here.
              */}
              {openGames === undefined && (
                <p className={styles.empty}>Loading…</p>
              )}
              {openGames && openGames.games.length === 0 && (
                <p className={styles.empty}>
                  No open games at the moment. Start a game, leave a seat empty,
                  and tick “Anyone can find and join these seats” — it’ll show
                  up here for somebody else to take.
                </p>
              )}
              {openGames?.games.map((g) => (
                <div key={g.gameId} className={styles.row}>
                  <span className={styles.grow}>
                    {g.name}
                    <span className={styles.openWith}>
                      {g.players.join(", ")} · {g.seatsFilled} of{" "}
                      {g.playerCount}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={styles.join}
                    onClick={() => void joinOpen(g.gameId)}
                  >
                    Join
                  </button>
                </div>
              ))}
              {joinError !== null && (
                <p className={styles.error}>{joinError}</p>
              )}
            </>
          )}
        </section>
      )}

      {past.length > 0 && (
        <section className={styles.section}>
          <button
            type="button"
            className={styles.disclosure}
            onClick={() => setShowPast((open) => !open)}
            aria-expanded={showPast}
          >
            {showPast ? "▾" : "▸"} Past games ({past.length})
          </button>

          {showPast &&
            past.map((g) => (
              <div key={g.gameId} className={styles.row}>
                <span className={styles.grow}>
                  {g.name} — {g.youWon ? "won" : "lost"} · {g.yourScore} pts
                  {g.opponents.length > 0 &&
                    ` vs ${g.opponents.map((o) => o.name).join(", ")}`}
                  <br />
                  <span className={styles.meta}>
                    {g.abandoned ? "someone quit" : `${g.tileCount} tiles`}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => onOpen(g.gameId)}
                >
                  View
                </button>
              </div>
            ))}
        </section>
      )}

      {viewer?.stats && (
        <section className={styles.section}>
          <h2 className={styles.heading}>Your record</h2>
          <div className={styles.stats}>
            <span className={styles.stat}>
              <strong>{viewer.stats.wins}</strong>
              wins
            </span>
            <span className={styles.stat}>
              <strong>{viewer.stats.gamesPlayed}</strong>
              games
            </span>
            <span className={styles.stat}>
              <strong>{viewer.stats.bestGameScore}</strong>
              best game
            </span>
            <span className={styles.stat}>
              <strong>{viewer.stats.bestTurnScore}</strong>
              best play
            </span>
          </div>
          <p className={styles.betaNote}>
            Counts games played under the rules as they stand. The rules are
            still moving — bag, rack, scoring — and when they change these start
            again, since a score set with a different bag never competed with a
            newer one. The games themselves are kept either way.
          </p>
        </section>
      )}
    </div>
  );
}
