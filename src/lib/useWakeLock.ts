import { useEffect } from "react";

/**
 * Keep the screen on while a game is open.
 *
 * A turn can be several minutes of staring at the board without touching it,
 * and a phone dimming mid-thought is its own kind of annoying. The lock is
 * dropped when the tab is hidden and taken again on return, since the browser
 * releases it either way.
 *
 * Unsupported on some browsers; there is nothing to fall back to, so it simply
 * does nothing there.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const take = async () => {
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) void sentinel.release();
        else lock = sentinel;
      } catch {
        // Denied, or the tab was backgrounded mid-request. Not worth surfacing.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void take();
    };

    void take();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release();
    };
  }, [active]);
}
