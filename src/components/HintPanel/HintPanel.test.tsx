import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { HintPanel } from "./HintPanel";

afterEach(cleanup);

const MOVE = {
  placements: [{ x: 7, y: 7, letter: "A", isBlank: false }],
  total: 39,
  words: [
    { word: "CAT", points: 6, rare: false, multiplier: 2 },
    { word: "QAT", points: 3, rare: true },
  ],
  squares: 1,
  leavesOpen: 0,
};
const RESULT = { turnNumber: 0, moves: [MOVE], rackWords: ["CATS", "ACT"] };

const panel = (over: Partial<Parameters<typeof HintPanel>[0]> = {}) =>
  render(
    <HintPanel
      canAsk
      result={RESULT}
      loading={false}
      error={null}
      onAsk={vi.fn()}
      onPick={vi.fn()}
      {...over}
    />,
  );

describe("HintPanel", () => {
  test("tapping a card picks that move", () => {
    const onPick = vi.fn();
    panel({ onPick });
    fireEvent.click(screen.getByRole("button", { name: /39/ }));
    expect(onPick).toHaveBeenCalledWith(MOVE);
  });

  test("a rare word says so, and the reasons are shown", () => {
    panel();
    expect(screen.getByText(/rare/)).toBeTruthy();
    expect(screen.getByText(/closes a 3×3/)).toBeTruthy();
  });

  test("no play found says so", () => {
    panel({ result: { turnNumber: 0, moves: [], rackWords: [] } });
    expect(screen.getByText(/No play found/)).toBeTruthy();
  });

  test("the button waits while thinking, and is off when it is not your turn", () => {
    const { unmount } = panel({ loading: true, result: null });
    expect((screen.getByRole("button", { name: "Thinking…" })).hasAttribute("disabled")).toBe(true);
    unmount();
    panel({ canAsk: false, result: null });
    expect((screen.getByRole("button", { name: "Hint" })).hasAttribute("disabled")).toBe(true);
  });

  test("a finished game keeps the tag but offers no Hint button", () => {
    panel({ active: false });
    expect(screen.getByText("Practice")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /hint|thinking/i })).toBeNull();
  });
});
