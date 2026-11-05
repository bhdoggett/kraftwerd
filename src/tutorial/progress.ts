/**
 * What the tutorial keeps on this device: where the player left off, so a
 * return can pick up there, and a few counts of how far people get. Nothing
 * leaves the device.
 *
 * localStorage, read and written in try/catch: a blocked store just means a
 * fresh start, which is the harmless way to be wrong.
 */
import { PLAYER_SEAT, SCRIPT } from "./script";

const RESUME = "kraftwerd:tutorial-resume";

/** The player's turns after their first: the only places a return can pick up. */
const RESUMABLE = SCRIPT.flatMap((t, i) => (t.seat === PLAYER_SEAT ? [i] : [])).slice(1);
const STATS = "kraftwerd:tutorial-stats";

export function savedTurn(): number | null {
  try {
    const raw = window.localStorage.getItem(RESUME);
    const n = raw === null ? NaN : Number(raw);
    return RESUMABLE.includes(n) ? n : null;
  } catch {
    return null;
  }
}

export function saveTurn(turn: number): void {
  try {
    window.localStorage.setItem(RESUME, String(turn));
  } catch {
    // No store: the next visit starts over.
  }
}

export function forgetTurn(): void {
  try {
    window.localStorage.removeItem(RESUME);
  } catch {
    // Nothing to forget.
  }
}

/** How far people get: opened, furthest turn reached, skipped to the end, finished. */
export interface TutorialStats {
  opened: number;
  furthest: number;
  skipped: number;
  finished: number;
}

export function readStats(): TutorialStats {
  const none = { opened: 0, furthest: 0, skipped: 0, finished: 0 };
  try {
    const raw = window.localStorage.getItem(STATS);
    if (raw === null) return none;
    const read: unknown = JSON.parse(raw);
    const field = (k: keyof TutorialStats) => {
      const v = typeof read === "object" && read !== null ? (read as Record<string, unknown>)[k] : undefined;
      return typeof v === "number" && Number.isFinite(v) ? v : 0;
    };
    return { opened: field("opened"), furthest: field("furthest"), skipped: field("skipped"), finished: field("finished") };
  } catch {
    return none;
  }
}

export function recordStats(change: (s: TutorialStats) => TutorialStats): void {
  try {
    window.localStorage.setItem(STATS, JSON.stringify(change(readStats())));
  } catch {
    // Counting is a nicety.
  }
}
