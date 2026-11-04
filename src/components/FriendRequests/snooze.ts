/** How long "Later" keeps the reminder away. */
const SNOOZE_MS = 24 * 60 * 60 * 1000;
const SNOOZE_KEY = "kraftwerd:friend-requests-snoozed-until";

/*
 * The snooze is a per-device convenience, so it lives in this browser only
 * and every read and write is allowed to fail: a private window, blocked
 * storage or a thumbnail render just means the reminder can show again.
 */
export function snoozedUntil(): number {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** Whether "Later" is still in force on this device. Read it when it matters, not in render. */
export function friendRequestsSnoozed(): boolean {
  return Date.now() < snoozedUntil();
}

/**
 * Whether the reminder would be on screen: requests waiting, no game result
 * ahead of it, and not snoozed. Shared so other notices can wait their turn.
 */
export function friendRequestsShowing(
  incomingCount: number,
  pendingResultCount: number,
  snoozed: boolean,
): boolean {
  return incomingCount > 0 && pendingResultCount === 0 && !snoozed;
}

export function snooze(now: number) {
  try {
    localStorage.setItem(SNOOZE_KEY, String(now + SNOOZE_MS));
  } catch {
    // Nowhere to remember it; the reminder comes back next load.
  }
}

