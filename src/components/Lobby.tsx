import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Difficulty } from "../../shared/config";
import { CreateGame } from "./CreateGame";
import { GuestGame } from "./GuestGame";
import { DevTools } from "./DevTools";
import { NewGame } from "./NewGame";
import { claimPromisedGame, useStartGame } from "../lib/useStartGame";
import styles from "./Lobby.module.css";

export function Lobby({ onOpen }: { onOpen: (gameId: Id<"games">) => void }) {
  const mine = useQuery(api.games.listMyGames);
  const respondToInvite = useMutation(api.games.respondToInvite);

  const myGames = mine?.games ?? [];
  const invitations = mine?.invitations ?? [];
  const past = mine?.past ?? [];
  const [showPast, setShowPast] = useState(false);
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
    bots: Difficulty[],
  ) {
    const game = await start(playerCount, friendIds, bots);
    if (game === null) return;

    setCreating(false);
    const taken = 1 + friendIds.length + bots.length;
    if (taken === playerCount) onOpen(game.gameId);
    else setSetup({ ...game, invited: friendIds.length + bots.length });
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
        : void startGame(2, [], ["medium"]),
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

      <button type="button" className={styles.newGame} onClick={() => setCreating(true)}>
        New game
      </button>

      {creating &&
        (viewer?.isGuest === true ? (
          <GuestGame
            onStart={(playerCount, bots) => void startGame(playerCount, [], bots)}
            onCancel={() => {
              setCreating(false);
              clearError();
            }}
            starting={starting}
            error={startError}
          />
        ) : (
          <CreateGame
            onStart={(playerCount, friendIds, bots) =>
              void startGame(playerCount, friendIds, bots)
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
        {mine && myGames.length === 0 && <p className={styles.empty}>No games yet.</p>}
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
                  <> {" · "} waiting for {g.waitingFor}</>
                )}
              </span>
            </span>
            {g.yourTurn && <span className={styles.badge}>Your turn</span>}
            <button type="button" className={styles.button} onClick={() => onOpen(g.gameId)}>
              Open
            </button>
          </div>
        ))}
      </section>

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
            still moving — bag, rack, scoring — and when they change these
            start again, since a score set with a different bag never competed
            with a newer one. The games themselves are kept either way.
          </p>
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
    </div>
  );
}
