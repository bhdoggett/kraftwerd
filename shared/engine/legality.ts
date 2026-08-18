import { cellKey, type Board } from "./board.js";
import { runsThrough } from "./runs.js";
import type { Placement } from "./score.js";

export interface Dictionary {
  has(word: string): boolean;
}

export interface Bounds {
  width: number;
  height: number;
}

export type Legality =
  | { ok: true }
  | { ok: false; reason: "empty-turn" }
  | { ok: false; reason: "out-of-bounds"; at: { x: number; y: number } }
  | { ok: false; reason: "occupied"; at: { x: number; y: number } }
  | { ok: false; reason: "duplicate-cell"; at: { x: number; y: number } }
  | { ok: false; reason: "disconnected" }
  | { ok: false; reason: "invalid-words"; words: string[] };

const NEIGHBOURS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
] as const;

/** Whether every tile on the board forms a single orthogonally-connected mass. */
function isOneMass(board: Board): boolean {
  const start = board.keys().next();
  if (start.done) return true;

  const seen = new Set<string>([start.value]);
  const queue = [start.value.split(",").map(Number) as [number, number]];

  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    for (const { dx, dy } of NEIGHBOURS) {
      const key = cellKey(x + dx, y + dy);
      if (!board.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push([x + dx, y + dy]);
    }
  }

  return seen.size === board.size;
}

/** The board as it stands after `placements` are applied to `before`. */
export function applyPlacements(before: Board, placements: readonly Placement[]): Board {
  const next = new Map(before);
  for (const p of placements) {
    next.set(cellKey(p.x, p.y), { letter: p.letter, isBlank: p.isBlank });
  }
  return next;
}

/**
 * Every word this turn puts on the board and so must be in the dictionary.
 *
 * Runs of 2+ count as words. A tile with no neighbours forms no such run and
 * is checked on its own letter instead -- reachable only on the opening play,
 * since connectivity gives every later tile a neighbour.
 *
 * Exported so a caller holding the dictionary out of process (Convex) can
 * fetch just these words instead of loading all 59k.
 */
export function wordsFormed(after: Board, placements: readonly Placement[]): string[] {
  const runs = runsThrough(after, placements);
  const covered = new Set(runs.flatMap((r) => r.cells.map((c) => cellKey(c.x, c.y))));
  const lone = placements
    .filter((p) => !covered.has(cellKey(p.x, p.y)))
    .map((p) => p.letter.toUpperCase());

  return [...runs.map((r) => r.word), ...lone];
}

/** Whether `placements` form a legal turn against `before` (design.md §3). */
export function validateTurn(
  before: Board,
  placements: readonly Placement[],
  dictionary: Dictionary,
  bounds: Bounds,
): Legality {
  if (placements.length === 0) return { ok: false, reason: "empty-turn" };

  const claimed = new Set<string>();
  for (const p of placements) {
    const at = { x: p.x, y: p.y };
    const key = cellKey(p.x, p.y);

    if (p.x < 0 || p.y < 0 || p.x >= bounds.width || p.y >= bounds.height) {
      return { ok: false, reason: "out-of-bounds", at };
    }
    if (before.has(key)) return { ok: false, reason: "occupied", at };
    if (claimed.has(key)) return { ok: false, reason: "duplicate-cell", at };
    claimed.add(key);
  }

  const after = applyPlacements(before, placements);

  if (!isOneMass(after)) return { ok: false, reason: "disconnected" };

  const bad = wordsFormed(after, placements).filter((w) => !dictionary.has(w));

  if (bad.length > 0) {
    return { ok: false, reason: "invalid-words", words: [...new Set(bad)] };
  }

  return { ok: true };
}
