import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DevTools } from "./DevTools";
import { NewGame } from "./NewGame";
import styles from "./Lobby.module.css";

export function Lobby({ onOpen }: { onOpen: (gameId: Id<"games">) => void }) {
  const mine = useQuery(api.games.listMyGames);
  const respondToInvite = useMutation(api.games.respondToInvite);
  const createGame = useMutation(api.games.createGame);

  const myGames = mine?.games ?? [];
  const invitations = mine?.invitations ?? [];
  const past = mine?.past ?? [];
  const [showPast, setShowPast] = useState(false);
  /** The game just created, still choosing who fills its seats. */
  const [setup, setSetup] = useState<{
    gameId: Id<"games">;
    name: string;
    playerCount: number;
  } | null>(null);

  const viewer = useQuery(api.users.viewer);

  return (
    <div className={styles.lobby}>
      {setup && (
        <NewGame
          gameId={setup.gameId}
          name={setup.name}
          playerCount={setup.playerCount}
          onOpen={(id) => {
            setSetup(null);
            onOpen(id);
          }}
          onClose={() => setSetup(null)}
        />
      )}

      <DevTools />

      <section className={styles.section}>
        <h2 className={styles.heading}>New game</h2>
        <div className={styles.create} role="group" aria-labelledby="playerCount">
          <span className={styles.rowLabel} id="playerCount">
            Players
          </span>
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              className={styles.secondary}
              // One player is a game; the rest need people before they need a
              // board, so creating one opens the invite step instead.
              onClick={() =>
                n === 1
                  ? void createGame({ playerCount: 1 }).then((game) =>
                      onOpen(game.gameId),
                    )
                  : void createGame({ playerCount: n }).then(setSetup)
              }
              aria-label={n === 1 ? "Solo game" : `${n} players`}
              title={n === 1 ? "Just you — starts straight away" : undefined}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

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
                {g.status === "lobby" ? "waiting" : `${g.yourScore} pts`}
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
