import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Rack } from "./Rack";

afterEach(cleanup);

function draw(props: Partial<Parameters<typeof Rack>[0]> = {}) {
  const onPlay = vi.fn();

  render(
    <Rack
      seat={0}
      letters={["A", "T"]}
      spent={[]}
      blanks={0}
      selected={null}
      onSelect={vi.fn()}
      onGrab={vi.fn()}
      order={[0, 1]}
      previewOrder={[0, 1]}
      draggedIndex={null}
      dragOverRack={false}
      onShuffle={vi.fn()}
      onRecall={vi.fn()}
      canRecall={false}
      trading={null}
      onToggleTrade={vi.fn()}
      onStartTrade={vi.fn()}
      canTrade={false}
      onPass={vi.fn()}
      canPass={false}
      passing={false}
      onPlay={onPlay}
      canPlay={false}
      playing={false}
      {...props}
    />,
  );

  return { onPlay, play: screen.getByRole("button", { name: "Play" }) };
}

describe("the Play button when it cannot be played", () => {
  test("answers the press when it is somebody else's turn", () => {
    // A truly disabled button fires no click, so it cannot say whose turn it
    // is -- which is the one thing pressing it is asking.
    const { onPlay, play } = draw({ playAnswers: true });

    fireEvent.click(play);

    expect(onPlay).toHaveBeenCalled();
    expect(play.getAttribute("aria-disabled")).toBe("true");
  });

  test("stays dead when there is nothing to say", () => {
    const { onPlay, play } = draw();

    fireEvent.click(play);

    expect(onPlay).not.toHaveBeenCalled();
    expect(play.getAttribute("aria-disabled")).toBe("true");
  });

  test("plays, when it can", () => {
    const { onPlay, play } = draw({ canPlay: true });

    fireEvent.click(play);

    expect(onPlay).toHaveBeenCalled();
    expect(play.getAttribute("aria-disabled")).toBe("false");
  });
});
