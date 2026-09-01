/** What a turn did, as much of it as rebuilding the board needs. */
export interface ReplayTurn {
  userId: string;
  kind: "play" | "pass" | "trade";
  /** What it scored, so a review can count up as it goes. */
  score: number;
  placements: readonly {
    x: number;
    y: number;
    letter: string;
    isBlank: boolean;
  }[];
}

export interface ReplayTile {
  x: number;
  y: number;
  letter: string;
  isBlank: boolean;
  placedBy: string;
  stacked: number;
}

/**
 * The board as it stood after `upTo` turns.
 *
 * Rebuilt by replaying what was played rather than kept as snapshots: the
 * turns already record every placement, so a stored copy of each position
 * would be the same facts written twice and able to disagree with itself.
 *
 * A tile laid on another takes the square — the letter on top is the one that
 * reads, and it wears the colour of whoever laid it — while the count of what
 * has landed there carries on, since that is what closes a square.
 */
export function boardAfter(
  turns: readonly ReplayTurn[],
  upTo: number,
): ReplayTile[] {
  const board = new Map<string, ReplayTile>();

  for (const turn of turns.slice(0, Math.max(0, upTo))) {
    for (const p of turn.placements) {
      const key = `${p.x},${p.y}`;
      const sitting = board.get(key);
      board.set(key, {
        x: p.x,
        y: p.y,
        letter: p.letter,
        isBlank: p.isBlank,
        placedBy: turn.userId,
        stacked: (sitting?.stacked ?? 0) + 1,
      });
    }
  }

  return [...board.values()];
}

/**
 * What everyone had scored after `upTo` turns.
 *
 * Counted up from the turns rather than read off the players, whose scores
 * are the final ones: a review that showed the finished total against a
 * half-played board would be answering a question nobody asked.
 *
 * Turn scores only. The swing at the end -- the tiles left in hand, handed to
 * whoever went out -- is not a turn and is not counted here, so the last
 * frame of a review is the game before that settlement rather than after it.
 */
export function scoresAfter(
  turns: readonly ReplayTurn[],
  upTo: number,
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const turn of turns.slice(0, Math.max(0, upTo))) {
    scores.set(turn.userId, (scores.get(turn.userId) ?? 0) + turn.score);
  }

  return scores;
}
