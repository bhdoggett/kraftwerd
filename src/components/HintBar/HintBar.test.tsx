import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { HintBar } from "./HintBar";

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

const bar = (over: Partial<Parameters<typeof HintBar>[0]> = {}) =>
  render(
    <HintBar
      canAsk
      turnKey="g:0"
      result={RESULT}
      loading={false}
      error={null}
      onAsk={vi.fn()}
      onPick={vi.fn()}
      {...over}
    />,
  );

const hint = () => screen.getByRole("button", { name: "Hint" });
const words = () => screen.getByRole("button", { name: "Words in your rack" });

describe("HintBar", () => {
  test("Hint opens a popover; tapping a card picks that move and closes it", () => {
    const onPick = vi.fn();
    bar({ onPick });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(hint());
    fireEvent.click(screen.getByRole("button", { name: /39/ }));

    expect(onPick).toHaveBeenCalledWith(MOVE);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a rare word says so, and the reasons are shown", () => {
    bar();
    fireEvent.click(hint());
    expect(screen.getByText(/rare/)).toBeTruthy();
    expect(screen.getByText(/closes a 3×3/)).toBeTruthy();
  });

  test("no play found says so", () => {
    bar({ result: { turnNumber: 0, moves: [], rackWords: [] } });
    fireEvent.click(hint());
    expect(screen.getByText(/No play found/)).toBeTruthy();
  });

  test("words in your rack opens its own popover", () => {
    bar();
    fireEvent.click(words());
    expect(screen.getByText("CATS, ACT")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /39/ })).toBeNull();
  });

  test("the first press asks; a press with an answer in hand does not", () => {
    const onAsk = vi.fn();
    const { unmount } = bar({ result: null, onAsk });
    fireEvent.click(words());
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Thinking…")).toBeTruthy();
    unmount();

    const again = vi.fn();
    bar({ onAsk: again });
    fireEvent.click(hint());
    expect(again).not.toHaveBeenCalled();
  });

  test("a popover left open does not come back on a later turn", () => {
    const { rerender } = bar();
    fireEvent.click(hint());
    expect(screen.getByRole("dialog")).toBeTruthy();

    const props = {
      canAsk: true,
      result: null,
      loading: false,
      error: null,
      onAsk: vi.fn(),
      onPick: vi.fn(),
    };
    rerender(<HintBar {...props} turnKey="g:1" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the buttons are off when it is not your turn", () => {
    bar({ canAsk: false });
    expect(hint().hasAttribute("disabled")).toBe(true);
    expect(words().hasAttribute("disabled")).toBe(true);
  });

  test("a finished game keeps the tag but offers no buttons", () => {
    bar({ active: false });
    expect(screen.getByText("Practice")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
