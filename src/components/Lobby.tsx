import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import styles from "./Lobby.module.css";

export function Lobby({ onOpen }: { onOpen: (gameId: Id<"games">) => void }) {
  const mine = useQuery(api.games.listMyGames);
  const open = useQuery(api.games.listOpenGames);
  const createGame = useMutation(api.games.createGame);
  const joinGame = useMutation(api.games.joinGame);

  const joinable = (open ?? []).filter(
    (g) => !(mine ?? []).some((m) => m.gameId === g.gameId),
  );

  return (
    <div className={styles.lobby}>
      <section className={styles.section}>
        <h2 className={styles.heading}>New game</h2>
        <div className={styles.create}>
          <button
            type="button"
            className={styles.button}
            onClick={() => void createGame({ playerCount: 1 }).then(onOpen)}
          >
            Solo
          </button>
          {[2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              className={styles.secondary}
              onClick={() => void createGame({ playerCount: n }).then(onOpen)}
            >
              {n} players
            </button>
          ))}
        </div>
        <p className={styles.empty}>
          A solo game starts straight away. Multiplayer games wait in the lobby
          until every seat is filled — share the invite link from inside the
          game.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Your games</h2>
        {mine === undefined && <p className={styles.empty}>Loading…</p>}
        {mine?.length === 0 && <p className={styles.empty}>No games yet.</p>}
        {mine?.map((g) => (
          <div key={g.gameId} className={styles.row}>
            <span className={styles.grow}>
              Seat {g.yourSeat + 1} · {g.yourScore} pts
              <br />
              <span className={styles.meta}>
                {g.status} · {g.tileCount} tiles
              </span>
            </span>
            {g.yourTurn && <span className={styles.badge}>Your turn</span>}
            <button type="button" className={styles.button} onClick={() => onOpen(g.gameId)}>
              Open
            </button>
          </div>
        ))}
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Open games</h2>
        {joinable.length === 0 && <p className={styles.empty}>Nothing waiting.</p>}
        {joinable.map((g) => (
          <div key={g.gameId} className={styles.row}>
            <span className={styles.grow}>
              <span className={styles.meta}>
                {g.joined} of {g.playerCount} seats filled
              </span>
            </span>
            <button
              type="button"
              className={styles.button}
              onClick={() => void joinGame({ gameId: g.gameId }).then(() => onOpen(g.gameId))}
            >
              Join
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
