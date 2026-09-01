import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Board } from "./Board";

afterEach(cleanup);

/**
 * The board, with nothing on it and a tile in hand.
 *
 * Only what a test overrides is worth stating: everything else is the plain
 * case -- an open board, your turn, a tile selected and ready to land.
 */
function draw(props: Partial<Parameters<typeof Board>[0]> = {}) {
  const onPlace = vi.fn();
  const onPickUp = vi.fn();
  const onGrabStaged = vi.fn();

  render(
    <Board
      boardSize={5}
      layout="open"
      tiles={[]}
      pending={[]}
      seatOf={new Map()}
      yourSeat={0}
      canPlace={true}
      onPlace={onPlace}
      onPickUp={onPickUp}
      onGrabStaged={onGrabStaged}
      {...props}
    />,
  );

  return { onPlace, onPickUp, onGrabStaged };
}

/** The square at these coordinates, found the way a player finds it. */
const square = (x: number, y: number) =>
  screen.getByLabelText(new RegExp(`column ${x + 1}, row ${y + 1}$`));

/** A press, a movement far enough to count as a drag, and a release. */
function dragFrom(element: Element, by: { x: number; y: number }) {
  fireEvent.pointerDown(element, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(window, {
    pointerId: 1,
    clientX: 100 + by.x,
    clientY: 100 + by.y,
  });
  fireEvent.pointerUp(window, { pointerId: 1 });
}

describe("placing a tile by tapping", () => {
  test("a tap on an open square plays the tile in hand there", () => {
    const { onPlace } = draw();

    fireEvent.pointerDown(square(2, 3), { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.click(square(2, 3));

    expect(onPlace).toHaveBeenCalledWith(2, 3);
  });

  test("nothing lands when there is nothing in hand", () => {
    const { onPlace } = draw({ canPlace: false });

    fireEvent.click(square(2, 3));

    expect(onPlace).not.toHaveBeenCalled();
  });

  test("a tap still lands after a staged tile has been dragged", () => {
    // The drag sets a flag that stops the pointerup ending it from reading as
    // a tap. That flag outlived its gesture once, and swallowed every later
    // tap on the board -- which is the whole of placing a tile without
    // dragging one, keyboard included.
    const staged = [{ x: 1, y: 1, letter: "A", isBlank: false }];
    const { onPlace } = draw({ pending: staged });

    dragFrom(square(1, 1), { x: 60, y: 0 });

    fireEvent.pointerDown(square(2, 3), { pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 2 });
    fireEvent.click(square(2, 3));

    expect(onPlace).toHaveBeenCalledWith(2, 3);
  });

  test("a tap on a blocked square does nothing", () => {
    const { onPlace } = draw({ layout: "Bars", boardSize: 15 });
    const [blocked] = screen.getAllByLabelText(/^blocked square/);

    fireEvent.click(blocked);

    expect(onPlace).not.toHaveBeenCalled();
  });
});

describe("picking a staged tile back up", () => {
  const staged = [{ x: 1, y: 1, letter: "A", isBlank: false }];

  test("a tap on your own staged tile takes it back", () => {
    const { onPickUp } = draw({ pending: staged });

    fireEvent.pointerDown(square(1, 1), { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.click(square(1, 1));

    expect(onPickUp).toHaveBeenCalledWith(1, 1);
  });

  test("dropping one back where it came from leaves it there", () => {
    // The release lands on the square the press began on, so the browser
    // fires a click -- which must not be read as "take it back".
    const { onPickUp } = draw({ pending: staged });

    dragFrom(square(1, 1), { x: 60, y: 0 });
    fireEvent.click(square(1, 1));

    expect(onPickUp).not.toHaveBeenCalled();
  });

  test("a press that never moves is a tap, not a drag", () => {
    const { onPickUp } = draw({ pending: staged });

    dragFrom(square(1, 1), { x: 2, y: 2 });
    fireEvent.click(square(1, 1));

    expect(onPickUp).toHaveBeenCalledWith(1, 1);
  });
});

describe("pointing out what was played while you were away", () => {
  test("rings the squares it is given, and only those", () => {
    const played = [
      { x: 1, y: 1, letter: "A", isBlank: false, placedBy: "ann", stacked: 1 },
      { x: 2, y: 1, letter: "T", isBlank: false, placedBy: "ann", stacked: 1 },
    ];
    draw({ tiles: played, recentCells: new Set(["1,1"]) });

    expect(square(1, 1).className).toMatch(/recent/);
    expect(square(2, 1).className).not.toMatch(/recent/);
  });

  test("rings nothing when there is nothing to point out", () => {
    draw();

    expect(square(2, 2).className).not.toMatch(/recent/);
  });
});
