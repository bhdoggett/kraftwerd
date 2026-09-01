import { BagContents } from "./BagContents";
import styles from "./Scoreboard.module.css";

interface Standing {
  userId: string;
  seat: number;
  score: number;
  name: string;
  isYou: boolean;
  /**
   * Tiles in hand. The count, never the letters -- how many someone is
   * holding is public, the way a rack of tiles on a table is; what is on them
   * is not.
   */
  tilesInHand: number;
}

interface ScoreboardProps {
  players: readonly Standing[];
  currentSeat: number;
  tileCount: number;
  /** Tiles nobody has drawn yet: what is left of the game. */
  tilesLeft: number;
  bagSize: number;
  status: "lobby" | "active" | "finished";
  /** Absent when there is nothing to quit — a finished game, or a spectator. */
  onQuit?: () => void;
}

export function Scoreboard({
  players,
  currentSeat,
  tileCount,
  tilesLeft,
  bagSize,
  status,
  onQuit,
}: ScoreboardProps) {
  const ordered = [...players].sort((a, b) => a.seat - b.seat);
  const onTurn = ordered.find((p) => p.seat === currentSeat) ?? null;
  // How far through the bag the game is, which is how far through the game it
  // is: it ends when the tiles run out and somebody empties their hand.
  const pct = Math.min(100, Math.round(((bagSize - tilesLeft) / bagSize) * 100));

  return (
    <aside className={styles.panel}>
      {/*
        Whose move it is, said outright. The row for that seat was in bold,
        which tells you once you have worked out that bold is what it means.
      */}
      {status === "active" && (
        <p className={styles.turnLine}>
          {onTurn === null
            ? "Waiting"
            : onTurn.isYou
              ? "Your turn"
              : `${onTurn.name}'s turn`}
        </p>
      )}

      <div className={styles.header}>
        <h2 className={styles.heading}>Scores</h2>
        {onQuit && (
          <button type="button" className={styles.quit} onClick={onQuit}>
            Quit
          </button>
        )}
      </div>

      {ordered.map((p) => (
        <div key={p.userId} className={styles.row}>
          <span className={styles.dot} style={{ background: `var(--seat-${p.seat % 4})` }} />
          <span
            className={[
              styles.name,
              p.seat === currentSeat && status !== "finished" ? styles.turn : "",
            ].join(" ")}
          >
            {p.name}
            {p.isYou && <span className={styles.you}> (you)</span>}
          </span>
          {p.seat === currentSeat && status === "active" && (
            <span className={styles.playing} aria-label="to play">
              ▸
            </span>
          )}
          {/*
            How many tiles they are holding, once the bag can no longer top
            anyone up.

            Not before: while there are tiles to draw, every hand refills to a
            full rack after every play, so the number is seven on every row
            and says nothing. Once the bag is dry the hands start to differ,
            and what is left in them decides the game -- whoever goes out
            takes what everyone else is still holding.
          */}
          {(tilesLeft === 0 || status === "finished") && status !== "lobby" && (
            <span
              className={styles.tiles}
              aria-label={`${p.tilesInHand} ${p.tilesInHand === 1 ? "tile" : "tiles"} in hand`}
            >
              {p.tilesInHand}
            </span>
          )}
          <span className={styles.score}>{p.score}</span>
        </div>
      ))}

      <div className={styles.progress}>
        <div className={styles.bar}>
          <div className={styles.fill} style={{ width: `${pct}%` }} />
        </div>
        <p className={styles.caption}>
          {status === "finished"
            ? "Game over"
            : tilesLeft === 0
              ? "The bag is empty — play out your hand"
              : `${tileCount} tiles played`}
        </p>
      </div>

      {status !== "finished" && <BagContents left={tilesLeft} />}
    </aside>
  );
}
