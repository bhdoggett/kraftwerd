import type { PlayerSummary } from "../../../shared/summary";

/** Points a turn, to one place; a dash for somebody who never moved. */
export function average(row: Pick<PlayerSummary, "points" | "turns">): string {
  return row.turns === 0 ? "–" : (row.points / row.turns).toFixed(1);
}
