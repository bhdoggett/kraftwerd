import { useSyncExternalStore } from "react";

/**
 * A phone held sideways: wide, but not tall.
 *
 * The height cap is what separates a phone from a tablet or a desktop window,
 * which are also landscape but have room for the portrait layout. The same
 * query is repeated verbatim in the CSS modules, since a media query there
 * cannot import this constant; keep them in step.
 */
export const SHORT_LANDSCAPE =
  "(orientation: landscape) and (max-height: 500px)";

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(SHORT_LANDSCAPE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function snapshot() {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(SHORT_LANDSCAPE).matches
    : false;
}

/**
 * Whether the screen is currently short and sideways.
 *
 * Follows the phone as it turns. Where `matchMedia` is missing there is no
 * way to ask, so it answers false and the ordinary layout stays.
 */
export function useShortLandscape(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
