import { afterEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { BagContents } from "./BagContents";
import { axeViolations } from "../../test/axe";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Open the panel, the way a player does before reading any of it. */
function open(unseen: Record<string, number>) {
  const view = render(<BagContents left={40} unseen={unseen} />);
  fireEvent.click(screen.getByRole("button", { name: /tiles left/ }));
  return view;
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

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^E:/ }),
    );

    expect(screen.getByText(/4 of 11 still out there/)).toBeDefined();
  });

  test("tapping another letter moves the readout to it", () => {
    open({ E: 4, K: 1 });

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^E:/ }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^K:/ }),
    );

    expect(screen.queryByText(/4 of 11 still out there/)).toBeNull();
    expect(screen.getByText(/1 of 1 still out there/)).toBeDefined();
  });

  test("tapping the same letter again puts the readout away", () => {
    open({ E: 4 });
    const e = within(screen.getByRole("dialog")).getByRole("button", {
      name: /^E:/,
    });

    fireEvent.click(e);
    fireEvent.click(e);

    expect(screen.queryByText(/4 of 11 still out there/)).toBeNull();
  });

  test("a letter with none left still answers", () => {
    // The tile stays in the row at zero -- a shrinking alphabet would read as
    // a bug -- so tapping it has to say so rather than go quiet.
    open({});

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^K:/ }),
    );

    expect(screen.getByText(/0 of 1 still out there/)).toBeDefined();
  });

  test("lists the letters A to Z", () => {
    open({});

    const letters = within(screen.getByRole("dialog"))
      .getAllByRole("button", { name: /still out there/ })
      .map((b) => b.textContent);
    expect(letters).toEqual([...letters].sort());
    expect(letters[0]).toBe("A");
  });
});

describe("the dialog", () => {
  test("opens as a dialog", () => {
    open({});
    expect(
      screen.getByRole("dialog", { name: /still out there/i }),
    ).toBeDefined();
  });

  test("Escape closes it", () => {
    open({});
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the close button closes it", () => {
    open({});
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("closing returns focus to the tiles-left button", () => {
    open({});
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /tiles left/ }),
    );
  });

  test("goes away when the bag does", () => {
    const { unmount } = open({});
    unmount();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("accessibility", () => {
  test("the open bag has no axe violations", async () => {
    open({ E: 4, K: 1 });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^E:/ }),
    );
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

/*
 * The dialog's panel scrolls, so a popover past its edge is cut off. A sat on
 * the left edge and read "of 9 still out there".
 */
describe("a popover at the edge of the letters", () => {
  /** The row of letters runs 100 to 300; the popover is 150 wide. */
  function measuring(popoverLeft: number) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const isPopover = this.getAttribute("role") === "status";
      const left = isPopover ? popoverLeft : 100;
      const right = isPopover ? popoverLeft + 150 : 300;
      return { left, right } as DOMRect;
    });
  }

  const nudgeOf = () => {
    open({ A: 9 });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^A:/ }),
    );
    return screen.getByText(/still out there$/, { selector: "[role=status]" }).style
      .getPropertyValue("--nudge");
  };

  test("is moved in from the left edge", () => {
    measuring(60);
    expect(nudgeOf()).toBe("40px");
  });

  test("is moved in from the right edge", () => {
    measuring(180);
    expect(nudgeOf()).toBe("-30px");
  });

  test("stays centred with room either side", () => {
    measuring(120);
    expect(nudgeOf()).toBe("0px");
  });
});
