import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { drawnFrom } from "../../lib/drawn";
import { Rack } from "./Rack";
import { axeViolations } from "../../test/axe";

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
      onSwap={vi.fn()}
      canSwap={false}
      swapping={false}
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

describe("naming the buttons", () => {
  test("Recall's name starts with the word it shows", () => {
    // Voice control finds a button by what is written on it, so the name a
    // screen reader hears has to contain that word, not just paraphrase it.
    draw();

    const recall = screen.getByRole("button", {
      name: "Recall: take every tile back off the board",
    });
    expect(recall.textContent).toContain("Recall");
  });
});

describe("working out the fresh draw", () => {
  test("is whatever follows the letters kept", () => {
    // Played A and T out of CATS; kept C and S; drew E, R.
    expect(drawnFrom(["C", "A", "T", "S"], ["C", "S", "E", "R"])).toBe(2);
  });

  test("a rack that did not change drew nothing", () => {
    expect(drawnFrom(["C", "A"], ["C", "A"])).toBe(2);
  });

  test("a whole new rack is all drawn", () => {
    expect(drawnFrom(["C", "A"], ["X", "Y"])).toBe(0);
  });
});

describe("accessibility", () => {
  test("a rack with a tile selected has no axe violations", async () => {
    draw({ selected: { kind: "letter", index: 0 }, canRecall: true, canPlay: true });
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe("a rack standing as a column", () => {
  const slid = { letters: ["A", "T", "E", "S"], order: [0, 1, 2, 3], previewOrder: [1, 2, 3, 0] };

  test("a two-wide rack slides a tile across and down", () => {
    draw({ ...slid, columns: 2 });

    const tile = document.querySelector<HTMLElement>('[data-rack-slot="0"]');
    expect(tile?.style.transform).toBe(
      "translate(calc(var(--rack-step) * 1), calc(var(--rack-step-y) * 1))",
    );
  });

  test("a one-row rack still slides along its row", () => {
    draw(slid);

    const tile = document.querySelector<HTMLElement>('[data-rack-slot="0"]');
    expect(tile?.style.transform).toBe("translateX(calc(var(--rack-step) * 3))");
  });

  test("a two-wide rack keeps every action's name", () => {
    draw({ ...slid, columns: 2 });

    for (const name of [
      "Recall: take every tile back off the board",
      "Swap your whole rack, once a game",
      "Pass your turn",
      "Shuffle your tiles",
    ]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-label")).toBe(name);
    }
  });

  test("the blank tile sits in the grid after the last letter, with its count", () => {
    draw({ ...slid, columns: 2, blanks: 2 });

    const blank = screen.getByRole("button", { name: "Blank tile, 2 left" });
    const lastLetter = document.querySelector('[data-rack-slot="3"]');
    expect(blank.parentElement).toBe(lastLetter?.nextElementSibling);
  });
});
