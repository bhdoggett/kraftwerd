import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PLAYER_SEAT, SCRIPT } from "../../tutorial/script";
import { markTutorialStarted } from "../../tutorial/seen";
import { Tutorial } from "./Tutorial";

vi.mock("../../tutorial/seen", () => ({ markTutorialStarted: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(markTutorialStarted).mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function draw() {
  const onLeave = vi.fn();
  const onNewGame = vi.fn();
  const view = render(<Tutorial onLeave={onLeave} onNewGame={onNewGame} />);
  return { onLeave, onNewGame, ...view };
}

/** The opponent's pause before their move goes down. */
const wait = () => act(() => void vi.advanceTimersByTime(1000));

const button = (name: string) => screen.getByRole("button", { name });

const next = () => fireEvent.click(button("Next"));

const square = (x: number, y: number) =>
  screen.getByLabelText(new RegExp(`column ${x + 1}, row ${y + 1}$`));

const rack = () => within(document.querySelector<HTMLElement>("[data-rack]")!);

/** Press and let go without moving: a tap, which selects the tile. */
function tapTile(tile: Element) {
  fireEvent.pointerDown(tile, { pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerUp(window, { pointerId: 1 });
}

/** A letter from the rack, or "blank" for the blank. */
function stage(letter: string, x: number, y: number) {
  const tile =
    letter === "blank"
      ? rack().getByRole("button", { name: /^Blank tile/ })
      : rack().getAllByRole("button", { name: letter })[0];
  tapTile(tile);
  fireEvent.click(square(x, y), { detail: 1 });
}

/** Every tile of the turn on its ghost. */
function stageTurn(turn: number) {
  for (const p of SCRIPT[turn].placements) stage(p.isBlank ? "blank" : p.letter, p.x, p.y);
}

/** From the first screen to the player's first turn. */
function toTurnTwo() {
  wait();
  next();
}

describe("the tutorial", () => {
  test("opens on Isolde's move", () => {
    draw();
    expect(screen.getByText("1 / 17")).toBeTruthy();
    expect(screen.getByText("Isolde's move")).toBeTruthy();
    wait();
    // Her tiles are down, and the card explains them.
    expect(square(7, 7).getAttribute("aria-label")).toMatch(/^I, played by Isolde/);
    expect(screen.getByText(/Isolde opens the game/)).toBeTruthy();
  });

  test("marks this device as having started it", () => {
    draw();
    expect(markTutorialStarted).toHaveBeenCalledOnce();
  });

  test("Next reaches the player's turn, with a ghost for every tile", () => {
    draw();
    toTurnTwo();
    expect(screen.getByText("2 / 17")).toBeTruthy();
    expect(screen.getByText("Your move")).toBeTruthy();
    expect(screen.getAllByLabelText(/place [A-Z] here/)).toHaveLength(6);
    // The rack holds only this turn's tiles.
    expect(rack().getAllByRole("button", { name: /^[A-Z]$/ })).toHaveLength(5);
    expect(rack().getByRole("button", { name: /^Blank tile/ })).toBeTruthy();
  });

  test("Play looks off, and pressing it early says what is missing", () => {
    draw();
    toTurnTwo();
    const play = button("Play");
    expect(play.getAttribute("aria-disabled")).toBe("true");
    expect(play.hasAttribute("disabled")).toBe(false);

    fireEvent.click(play);
    expect(screen.getByText("6 more tiles to place.")).toBeTruthy();
    expect(screen.getByText("2 / 17")).toBeTruthy();
  });

  test("a tile off its ghost is ringed and explained", () => {
    draw();
    toTurnTwo();
    // The B belongs on 9,10; one square left of that is no ghost.
    stage("B", 8, 10);
    fireEvent.click(button("Play"));
    expect(screen.getByText(/The B goes on the glowing square one square right/)).toBeTruthy();
    expect(square(8, 10).getAttribute("aria-label")).toMatch(/not valid/);
  });

  test("the blank stages as its ghost's letter, with no letter picker", () => {
    draw();
    toTurnTwo();
    stage("blank", 9, 7);
    expect(square(9, 7).getAttribute("aria-label")).toMatch(/^S, your tile/);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("all six tiles on their ghosts play for 53", () => {
    draw();
    toTurnTwo();
    stageTurn(1);
    const play = button("Play");
    expect(play.getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(play);
    expect(screen.getByText(/\+53/)).toBeTruthy();
    expect(screen.getByText(/You closed your first 3×3/)).toBeTruthy();
    // The new square is outlined.
    expect(square(7, 7).getAttribute("aria-label")).toMatch(/in a valid word/);
  });

  test("starts over when it is opened again", () => {
    const first = draw();
    toTurnTwo();
    first.unmount();
    draw();
    expect(screen.getByText("1 / 17")).toBeTruthy();
  });

  test("× leaves", () => {
    const { onLeave } = draw();
    fireEvent.click(button("Leave tutorial"));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  test("the whole game ends on the final scores", () => {
    const { onLeave, onNewGame } = draw();
    for (let turn = 0; turn < SCRIPT.length; turn++) {
      expect(screen.getByText(`${turn + 1} / 17`)).toBeTruthy();
      if (SCRIPT[turn].seat === PLAYER_SEAT) {
        stageTurn(turn);
        fireEvent.click(button("Play"));
      } else {
        wait();
      }
      next();
    }

    expect(screen.queryByText(/Waiting/)).toBeNull();
    expect(screen.queryByText(/Your turn/)).toBeNull();
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Isolde won")).toBeTruthy();
    const scores = dialog.getAllByRole("listitem").map((li) => li.textContent);
    expect(scores).toEqual(["Isolde264", "Rostam253", "You239"]);

    fireEvent.click(dialog.getByRole("button", { name: "New game" }));
    expect(onNewGame).toHaveBeenCalledOnce();
    fireEvent.click(dialog.getByRole("button", { name: "Back to lobby" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });
});
