// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { makeBoard } from "../../../shared/engine/board";
import { useTileStaging, type TileStagingOptions } from "./useTileStaging";

afterEach(cleanup);

function options(overrides: Partial<TileStagingOptions> = {}): TileStagingOptions {
  return {
    letters: ["C", "A", "T"],
    blanks: 1,
    before: makeBoard([{ x: 5, y: 5, letter: "A" }]),
    canPlace: true,
    nameBlank: () => null,
    refuse: vi.fn(),
    ...overrides,
  };
}

describe("useTileStaging", () => {
  test("placing a selected letter stages it", () => {
    const { result } = renderHook(() => useTileStaging(options()));

    act(() => result.current.setSelected({ kind: "letter", index: 0 }));
    act(() => result.current.place(3, 4));

    expect(result.current.pending).toEqual([
      { x: 3, y: 4, letter: "C", isBlank: false, from: { kind: "letter", index: 0 } },
    ]);
    expect(result.current.selected).toBeNull();
    expect(result.current.spentIndices).toEqual([0]);
  });

  test("placing on a square holding the same letter refuses and stages nothing", () => {
    const refuse = vi.fn();
    const { result } = renderHook(() => useTileStaging(options({ refuse })));

    act(() => result.current.setSelected({ kind: "letter", index: 1 }));
    act(() => result.current.place(5, 5));

    expect(refuse).toHaveBeenCalledOnce();
    expect(result.current.pending).toEqual([]);
    expect(result.current.selected).toBeNull();
  });

  test("a blank named by the screen stages at once", () => {
    const { result } = renderHook(() =>
      useTileStaging(options({ nameBlank: () => "S" })),
    );

    act(() => result.current.setSelected({ kind: "blank" }));
    act(() => result.current.place(2, 2));

    expect(result.current.pending).toEqual([
      { x: 2, y: 2, letter: "S", isBlank: true, from: { kind: "blank" } },
    ]);
    expect(result.current.blankAt).toBeNull();
    expect(result.current.blanksLeft).toBe(0);
  });

  test("a blank the screen cannot name waits to be asked", () => {
    const { result } = renderHook(() => useTileStaging(options()));

    act(() => result.current.setSelected({ kind: "blank" }));
    act(() => result.current.place(2, 2));

    expect(result.current.pending).toEqual([]);
    expect(result.current.blankAt).toEqual({ x: 2, y: 2 });
    expect(result.current.blanksLeft).toBe(0);
  });

  test("recallAll empties the staged tiles", () => {
    const { result } = renderHook(() => useTileStaging(options()));

    act(() => result.current.setSelected({ kind: "letter", index: 2 }));
    act(() => result.current.place(1, 1));
    expect(result.current.pending).toHaveLength(1);

    act(() => result.current.recallAll());

    expect(result.current.pending).toEqual([]);
    expect(result.current.selected).toBeNull();
    expect(result.current.blankAt).toBeNull();
  });

  test("the rack order resets when the letters change", () => {
    const { result, rerender } = renderHook((o: TileStagingOptions) => useTileStaging(o), {
      initialProps: options(),
    });
    expect(result.current.rackOrder).toEqual([0, 1, 2]);

    act(() => result.current.shuffle());
    // Shuffled or not, it is still the same three tiles.
    expect([...result.current.rackOrder].sort()).toEqual([0, 1, 2]);

    rerender(options({ letters: ["D", "O", "G", "S"] }));

    expect(result.current.rackOrder).toEqual([0, 1, 2, 3]);
  });
});
