import styles from "./Scoreboard.module.css";

export interface Standing {
  userId: string;
  seat: number;
  score: number;
  name: string;
  isYou: boolean;
}

interface ScoreboardProps {
  players: readonly Standing[];
  currentSeat: number;
  tileCount: number;
  endThreshold: number;
  status: "lobby" | "active" | "finished";
}

export function Scoreboard({
  players,
  currentSeat,
  tileCount,
  endThreshold,
  status,
}: ScoreboardProps) {
  const ordered = [...players].sort((a, b) => a.seat - b.seat);
  const pct = Math.min(100, Math.round((tileCount / endThreshold) * 100));

  return (
    <aside className={styles.panel}>
      <h2 className={styles.heading}>Scores</h2>

      {ordered.map((p) => (
        <div key={p.userId} className={styles.row}>
          <span className={styles.dot} style={{ background: `var(--seat-${p.seat % 4})` }} />
          <span
            className={[styles.name, p.seat === currentSeat ? styles.turn : ""].join(" ")}
          >
            {p.name}
            {p.isYou && <span className={styles.you}> (you)</span>}
          </span>
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
            : `${tileCount} of ${endThreshold} tiles placed`}
        </p>
      </div>
    </aside>
  );
}
