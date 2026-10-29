import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SHORT_LANDSCAPE, useShortLandscape } from "./useShortLandscape";

/** A matchMedia stand-in that records its query and lets a test fire `change`. */
function stubMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const state = { matches: initial, query: "" };
  vi.stubGlobal("matchMedia", (query: string) => {
    state.query = query;
    return {
      get matches() {
        return state.matches;
      },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
  });
  return {
    state,
    turn(matches: boolean) {
      state.matches = matches;
      listeners.forEach((fn) => fn());
    },
  };
}

describe("useShortLandscape", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("is true when the screen is short and sideways", () => {
    const media = stubMatchMedia(true);
    const { result } = renderHook(useShortLandscape);
    expect(result.current).toBe(true);
    expect(media.state.query).toBe(SHORT_LANDSCAPE);
  });

  test("follows the phone as it turns", () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(useShortLandscape);
    expect(result.current).toBe(false);
    act(() => media.turn(true));
    expect(result.current).toBe(true);
  });

  test("is false without matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(useShortLandscape);
    expect(result.current).toBe(false);
  });
});
