import type { PlayerSummary } from "../../../shared/summary";

/** Points a turn, to one place; a dash for somebody who never moved. */
export function average(row: Pick<PlayerSummary, "points" | "turns">): string {
  return row.turns === 0 ? "–" : (row.points / row.turns).toFixed(1);
}

/** Points a tile played, to one place; a dash for somebody who played none. */
export function perTile(
  row: Pick<PlayerSummary, "points" | "tilesPlayed">,
): string {
  return row.tilesPlayed === 0
    ? "–"
    : (row.points / row.tilesPlayed).toFixed(1);
}
