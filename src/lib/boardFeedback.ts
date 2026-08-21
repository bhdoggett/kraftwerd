import type { Board } from "../../shared/engine/board";
import { runsThrough } from "../../shared/engine/runs";
import type { Placement } from "../../shared/engine/score";

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Placed squares that do not reach the rest of the board.
 *
 * Floods orthogonally from a tile that was already there — or from the first
 * placement when the board was empty — and reports whichever placements the
 * flood never reached.
 *
 * The premium corners are on the board from the start and sit alone until a
 * play arrives, so they cannot be used as the mass to grow from: starting the
 * flood on one marked every tile of a perfectly legal play as unreachable.
 */
function disconnectedCells(
  board: Board,
  placements: readonly Placement[],
  premium: ReadonlySet<string>,
): Set<string> {
  const orphans = new Set<string>();
  const placedKeys = new Set(placements.map((p) => `${p.x},${p.y}`));

  const existing = [...board.keys()].find(
    (key) => !placedKeys.has(key) && !premium.has(key),
  );
  const first = placements[0];
  const start = existing ?? (first ? `${first.x},${first.y}` : undefined);
  if (start === undefined) return orphans;

  const seen = new Set([start]);
  const queue = [start];

  while (queue.length > 0) {
    const [x, y] = queue.pop()!.split(",").map(Number);
    for (const [dx, dy] of NEIGHBOURS) {
      const key = `${x! + dx},${y! + dy}`;
      if (!board.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push(key);
    }
  }

  for (const key of placedKeys) if (!seen.has(key)) orphans.add(key);
  return orphans;
}

/**
 * Which squares to mark right and which to mark wrong while a play is staged.
 *
 * A run's verdict comes from the whole word, existing tiles included, but only
 * the tiles placed this turn are marked: colouring the others would suggest
 * this turn had put them there.
 */
export function markCells(
  after: Board,
  placements: readonly Placement[],
  validity: ReadonlyMap<string, boolean>,
  premium: ReadonlySet<string> = new Set(),
): { good: Set<string>; bad: Set<string> } {
  const good = new Set<string>();
  const bad = new Set<string>();
  const staged = new Set(placements.map((p) => `${p.x},${p.y}`));
  const inSomeRun = new Set<string>();

  for (const run of runsThrough(after, placements)) {
    const target = validity.get(run.word) === true ? good : bad;
    for (const cell of run.cells) {
      const key = `${cell.x},${cell.y}`;
      inSomeRun.add(key);
      if (staged.has(key)) target.add(key);
    }
  }

  // A tile touching nothing forms no run, so the loop above never saw it. On
  // its own it has to be a word in its own right — only A and I are.
  for (const p of placements) {
    const key = `${p.x},${p.y}`;
    if (inSomeRun.has(key)) continue;
    if (validity.get(p.letter.toUpperCase()) === true) good.add(key);
    else bad.add(key);
  }

  // Spelling and connectivity are separate: a good word that does not reach
  // the rest of the board is still an illegal play, and the board should say
  // so rather than leaving it to the message underneath.
  for (const key of disconnectedCells(after, placements, premium)) bad.add(key);

  for (const key of bad) good.delete(key);
  return { good, bad };
}
