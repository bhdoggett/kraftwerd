import { Capacitor } from "@capacitor/core";
import { StatusBar } from "@capacitor/status-bar";
import { useEffect } from "react";
import { useShortLandscape } from "./useShortLandscape";

/**
 * Hides Android's status bar while the phone is held sideways, where its
 * height is a large share of the screen, and brings it back upright.
 *
 * iOS already hides its own bar in landscape, and the web has none, so both
 * are left alone. A failure here is cosmetic, so it is swallowed rather than
 * allowed to break the screen.
 */
export async function syncStatusBar(shortLandscape: boolean): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  try {
    if (shortLandscape) await StatusBar.hide();
    else await StatusBar.show();
  } catch {
    // The bar stays as it was.
  }
}

/** Keeps the status bar in step with the phone's orientation, app-wide. */
export function useStatusBarForLandscape(): void {
  const shortLandscape = useShortLandscape();
  useEffect(() => {
    void syncStatusBar(shortLandscape);
  }, [shortLandscape]);
}
