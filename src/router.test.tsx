import { afterEach, describe, expect, test } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { forgetNewGame, navigate, useRoute } from "./router";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("the router", () => {
  test("/tutorial is the tutorial", () => {
    const { result } = renderHook(() => useRoute());
    act(() => navigate({ name: "tutorial" }));
    expect(window.location.pathname).toBe("/tutorial");
    expect(result.current).toEqual({ name: "tutorial" });
  });

  test("the lobby can be asked to open New game, once", () => {
    const { result } = renderHook(() => useRoute());
    act(() => navigate({ name: "tutorial" }));
    act(() => navigate({ name: "lobby", newGame: true }));
    expect(window.location.search).toBe("?new=1");
    expect(result.current).toEqual({ name: "lobby", newGame: true });

    forgetNewGame();
    expect(window.location.pathname + window.location.search).toBe("/");
  });

  test("a plain lobby is just the lobby", () => {
    const { result } = renderHook(() => useRoute());
    act(() => navigate({ name: "tutorial" }));
    act(() => navigate({ name: "lobby" }));
    expect(result.current).toEqual({ name: "lobby" });
  });
});
