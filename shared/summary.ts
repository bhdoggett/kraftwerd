import { cellKey } from "./engine/board.js";

/** What a turn row says, as much of it as the summary reads. */
export interface SummaryTurn<Id extends string = string> {
  turnNumber: number;
  userId: Id;
  /** Absent on rows written before anything but plays was recorded. */
  kind?: "play" | "pass" | "trade";
  placements: readonly { x: number; y: number }[];
  words: readonly string[];
  /** One entry per 3x3 the turn completed. */
  squares: readonly number[];
  score: number;
}

/** One player's game, added up. */
export interface PlayerSummary<Id extends string = string> {
  userId: Id;
  /** Every turn taken, passes and trades included. */
  turns: number;
  passes: number;
  trades: number;
  /** Points from turns, which is the whole score: nothing is settled at the end. */
  points: number;
  tilesPlayed: number;
  /** Tiles laid on a square that already held one. */
  stacks: number;
  /** 3x3 blocks completed. */
  squares: number;
  /** The highest-scoring play, earliest on a tie. Null for nobody who played. */
  bestPlay: { turnNumber: number; words: string[]; score: number } | null;
}

/**
 * How a finished game went, a player at a time: worked out once, when the
 * game ends, from the turn history.
 *
 * Stacks are found by walking the turns in order, since the tiles table keeps
 * only the top tile of a square and so cannot say who laid the ones beneath.
 * The board starts empty, so every occupied square was filled by some turn.
 */
export function summarizeGame<Id extends string>(
  turns: readonly SummaryTurn<Id>[],
  /** Every seated player, so somebody who never moved still gets a row. */
  players: readonly Id[],
): PlayerSummary<Id>[] {
  const rows = new Map<Id, PlayerSummary<Id>>(
    players.map((userId) => [
      userId,
      {
        userId,
        turns: 0,
        passes: 0,
        trades: 0,
        points: 0,
        tilesPlayed: 0,
        stacks: 0,
        squares: 0,
        bestPlay: null,
      },
    ]),
  );
  const occupied = new Set<string>();

  for (const turn of [...turns].sort((a, b) => a.turnNumber - b.turnNumber)) {
    const row = rows.get(turn.userId);
    const kind = turn.kind ?? "play";

    for (const p of kind === "play" ? turn.placements : []) {
      const key = cellKey(p.x, p.y);
      if (occupied.has(key) && row) row.stacks++;
      occupied.add(key);
    }
    if (row === undefined) continue;

    row.turns++;
    row.points += turn.score;
    if (kind === "pass") row.passes++;
    if (kind === "trade") row.trades++;
    if (kind !== "play") continue;

    row.tilesPlayed += turn.placements.length;
    row.squares += turn.squares.length;
    if (row.bestPlay === null || turn.score > row.bestPlay.score) {
      row.bestPlay = {
        turnNumber: turn.turnNumber,
        words: [...turn.words],
        score: turn.score,
      };
    }
  }

  return [...rows.values()];
}
