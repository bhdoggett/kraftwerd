import type { PlayerSummary } from "../../../shared/summary";
import { average } from "./figures";
import { SrOnly } from "../SrOnly/SrOnly";
import styles from "./GameSummary.module.css";

interface SummaryPlayer {
  userId: string;
  seat: number;
  name: string;
  isYou: boolean;
}

interface GameSummaryProps {
  /** Worked out when the game finished (`summarizeGame`). */
  summary: readonly PlayerSummary[];
  players: readonly SummaryPlayer[];
}

/**
 * How a finished game went, beside the board it was played on: a column a
 * player, a row a figure. The best play of the game is the biggest number in
 * the last row, so it is not said again underneath.
 *
 * Players across rather than down, because the side panel is narrow and there
 * are more figures than players: four columns fit, seven did not.
 */
export function GameSummary({ summary, players }: GameSummaryProps) {
  const ordered = [...players].sort((a, b) => a.seat - b.seat);
  const rows = ordered.flatMap((p) => {
    const row = summary.find((r) => r.userId === p.userId);
    return row === undefined ? [] : [{ player: p, row }];
  });
  if (rows.length === 0) return null;

  const nameOf = (p: SummaryPlayer) => (p.isYou ? "You" : p.name);
  const figures: {
    label: string;
    value: (row: PlayerSummary) => string | number;
  }[] = [
    { label: "Turns", value: (row) => row.turns },
    { label: "Avg / turn", value: average },
    { label: "Tiles played", value: (row) => row.tilesPlayed },
    { label: "Stacks", value: (row) => row.stacks },
    { label: "3x3s", value: (row) => row.squares },
    { label: "Best play", value: (row) => row.bestPlay?.score ?? "–" },
  ];

  return (
    <section aria-label="Game summary">
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">
              <SrOnly>Figure</SrOnly>
            </th>
            {rows.map(({ player }) => (
              <th
                key={player.userId}
                scope="col"
                className={styles.player}
                title={player.name}
              >
                <span className={styles.swatch} data-seat={player.seat} />
                {nameOf(player)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {figures.map((figure) => (
            <tr key={figure.label}>
              <th scope="row">{figure.label}</th>
              {rows.map(({ player, row }) => (
                <td key={player.userId}>{figure.value(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
