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

/**
 * A click as a pointer makes one. `detail` is the click count, and a pointer's
 * is at least 1; the keyboard's is 0, which is how the board tells the two
 * apart -- and what fireEvent.click sends unless told otherwise.
 */
const tap = (element: Element) => fireEvent.click(element, { detail: 1 });

/** Enter or Space on a focused square, as the browser reports it: a click
    with no count and no pointer behind it. */
const press = (element: Element) => fireEvent.click(element, { detail: 0 });

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
    tap(square(2, 3));

    expect(onPlace).toHaveBeenCalledWith(2, 3);
  });

  test("nothing lands when there is nothing in hand", () => {
    const { onPlace } = draw({ canPlace: false });

    tap(square(2, 3));

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
    tap(square(2, 3));

    expect(onPlace).toHaveBeenCalledWith(2, 3);
  });

  test("a pan swallows the click that ends it", () => {
    const { onPlace } = draw();

    dragFrom(square(2, 3), { x: 60, y: 0 });
    tap(square(2, 3));

    expect(onPlace).not.toHaveBeenCalled();
  });

  test("the keyboard still places a tile after the board has been panned", () => {
    // Only a pointerdown clears the pan flag, and Enter and Space send none,
    // so after any pan every key press on a square was swallowed as the end
    // of it -- until the next tap.
    const { onPlace } = draw();

    dragFrom(square(0, 0), { x: 60, y: 0 });
    press(square(2, 3));

    expect(onPlace).toHaveBeenCalledWith(2, 3);
  });

  test("the keyboard still picks a tile up after one has been dragged", () => {
    const staged = [{ x: 1, y: 1, letter: "A", isBlank: false }];
    const { onPickUp } = draw({ pending: staged });

    dragFrom(square(1, 1), { x: 60, y: 0 });
    press(square(1, 1));

    expect(onPickUp).toHaveBeenCalledWith(1, 1);
  });

  test("a tap on a blocked square does nothing", () => {
    const { onPlace } = draw({ layout: "Bars", boardSize: 15 });
    const [blocked] = screen.getAllByLabelText(/^blocked square/);

    tap(blocked);

    expect(onPlace).not.toHaveBeenCalled();
  });
});

describe("picking a staged tile back up", () => {
  const staged = [{ x: 1, y: 1, letter: "A", isBlank: false }];

  test("a tap on your own staged tile takes it back", () => {
    const { onPickUp } = draw({ pending: staged });

    fireEvent.pointerDown(square(1, 1), { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    tap(square(1, 1));

    expect(onPickUp).toHaveBeenCalledWith(1, 1);
  });

  test("dropping one back where it came from leaves it there", () => {
    // The release lands on the square the press began on, so the browser
    // fires a click -- which must not be read as "take it back".
    const { onPickUp } = draw({ pending: staged });

    dragFrom(square(1, 1), { x: 60, y: 0 });
    tap(square(1, 1));

    expect(onPickUp).not.toHaveBeenCalled();
  });

  test("a press that never moves is a tap, not a drag", () => {
    const { onPickUp } = draw({ pending: staged });

    dragFrom(square(1, 1), { x: 2, y: 2 });
    tap(square(1, 1));

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

describe("saying what the word rings show", () => {
  const played = [
    { x: 1, y: 1, letter: "A", isBlank: false, placedBy: "ann", stacked: 1 },
    { x: 2, y: 1, letter: "T", isBlank: false, placedBy: "ann", stacked: 1 },
    { x: 3, y: 1, letter: "Q", isBlank: false, placedBy: "ann", stacked: 1 },
  ];

  test("a square in a word that stands says so", () => {
    draw({ tiles: played, goodCells: new Set(["1,1"]) });

    expect(square(1, 1).getAttribute("aria-label")).toMatch(/in a valid word/);
  });

  test("a square in a word that does not stand says so", () => {
    draw({ tiles: played, badCells: new Set(["3,1"]) });

    expect(square(3, 1).getAttribute("aria-label")).toMatch(/in a word that is not valid/);
  });

  test("a square in one of each says the one that matters", () => {
    draw({ tiles: played, goodCells: new Set(["2,1"]), badCells: new Set(["2,1"]) });

    const label = square(2, 1).getAttribute("aria-label");
    expect(label).toMatch(/not valid/);
    expect(label).not.toMatch(/in a valid word/);
  });

  test("a square in no word says nothing about words", () => {
    draw({ tiles: played });

    expect(square(1, 1).getAttribute("aria-label")).not.toMatch(/word/);
  });
});

describe("zooming by button", () => {
  /*
   * Read off the buttons rather than the squares: the scale the squares are
   * drawn at is the zoom times a fit measured off the layout, and there is no
   * layout to measure here.
   */
  const button = (name: string) => screen.getByRole("button", { name });
  const off = (name: string) => button(name).getAttribute("aria-disabled") === "true";

  test("zooms in, fits again, and zooms out", () => {
    draw();
    expect(off("Fit the board")).toBe(true);

    fireEvent.click(button("Zoom in"));
    expect(off("Fit the board")).toBe(false);

    fireEvent.click(button("Fit the board"));
    expect(off("Fit the board")).toBe(true);

    // One step out from fitted is as far as it goes.
    fireEvent.click(button("Zoom out"));
    expect(off("Zoom out")).toBe(true);
    expect(off("Fit the board")).toBe(false);
  });

  test("stops once zoomed all the way in, and says so", () => {
    draw();

    for (let i = 0; i < 10; i++) fireEvent.click(button("Zoom in"));

    expect(off("Zoom in")).toBe(true);
    expect(off("Zoom out")).toBe(false);
  });
});
