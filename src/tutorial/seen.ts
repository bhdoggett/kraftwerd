/**
 * Whether this device has started the tutorial, from the sign-in page or
 * anywhere else. The first-time popover skips itself when it has.
 *
 * localStorage, read and written in try/catch: a blocked store just means the
 * popover shows, which is the harmless way to be wrong.
 */
const KEY = "kraftwerd:tutorial-started";

export function markTutorialStarted(): void {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    // Private browsing or no store: the popover will ask, which is fine.
  }
}

export function tutorialStartedHere(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}
