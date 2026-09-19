import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BagContents } from "./BagContents";

afterEach(cleanup);

/** Open the panel, the way a player does before reading any of it. */
function open(unseen: Record<string, number>) {
  render(<BagContents left={40} unseen={unseen} />);
  fireEvent.click(screen.getByRole("button", { expanded: false }));
}

/**
 * A count nobody can reach is not a count.
 *
 * Each letter carried its number in `title`, which is a tooltip: it needs a
 * pointer to hover, and a touch screen has none. On a phone -- which is where
 * this game is mostly played -- the rings said "some" and "hardly any" and
 * nothing else.
 */
describe("reading a letter's count", () => {
  test("tapping a letter says how many are still out there", () => {
    open({ E: 4 });

    fireEvent.click(screen.getByRole("button", { name: /^E:/ }));

    expect(screen.getByText(/4 of 10 still out there/)).toBeDefined();
  });

  test("tapping another letter moves the readout to it", () => {
    open({ E: 4, Z: 1 });

    fireEvent.click(screen.getByRole("button", { name: /^E:/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Z:/ }));

    expect(screen.queryByText(/4 of 10 still out there/)).toBeNull();
    expect(screen.getByText(/1 of 1 still out there/)).toBeDefined();
  });

  test("tapping the same letter again puts the readout away", () => {
    open({ E: 4 });
    const e = screen.getByRole("button", { name: /^E:/ });

    fireEvent.click(e);
    fireEvent.click(e);

    expect(screen.queryByText(/4 of 10 still out there/)).toBeNull();
  });

  test("a letter with none left still answers", () => {
    // The tile stays in the row at zero -- a shrinking alphabet would read as
    // a bug -- so tapping it has to say so rather than go quiet.
    open({});

    fireEvent.click(screen.getByRole("button", { name: /^Z:/ }));

    expect(screen.getByText(/0 of 1 still out there/)).toBeDefined();
  });
});
