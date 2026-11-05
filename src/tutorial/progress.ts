/**
 * What the tutorial keeps on this device: where the player left off, so a
 * return can pick up there, and a few counts of how far people get. Nothing
 * leaves the device.
 *
 * localStorage, read and written in try/catch: a blocked store just means a
 * fresh start, which is the harmless way to be wrong.
 */
const RESUME = "kraftwerd:tutorial-resume";
const STATS = "kraftwerd:tutorial-stats";

export function savedTurn(): number | null {
  try {
    const raw = window.localStorage.getItem(RESUME);
    const n = raw === null ? NaN : Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
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
    return raw === null ? none : { ...none, ...(JSON.parse(raw) as Partial<TutorialStats>) };
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
