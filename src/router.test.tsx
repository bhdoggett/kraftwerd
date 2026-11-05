import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { forgetNewGame, goBackOr, navigate, useRoute } from "./router";

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

  test("leaving goes to the fallback on a direct load", () => {
    window.history.replaceState(null, "", "/tutorial");
    const { result } = renderHook(() => useRoute());
    act(() => goBackOr({ name: "lobby" }));
    expect(window.location.pathname).toBe("/");
    expect(result.current).toEqual({ name: "lobby" });
  });

  test("leaving steps back when the tutorial was reached in the app", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    renderHook(() => useRoute());
    act(() => navigate({ name: "tutorial" }));
    act(() => goBackOr({ name: "lobby" }));
    expect(back).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe("/tutorial");
    back.mockRestore();
  });

  test("a plain lobby is just the lobby", () => {
    const { result } = renderHook(() => useRoute());
    act(() => navigate({ name: "tutorial" }));
    act(() => navigate({ name: "lobby" }));
    expect(result.current).toEqual({ name: "lobby" });
  });
});
