import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { factsFor } from "../../tutorial/model";
import { CoachCard, describeFeedback } from "./CoachCard";
import { axeViolations } from "../../test/axe";

afterEach(cleanup);

const base = { step: 2, total: 17, heading: "Your move", text: "Close your first square.", onLeave: () => {} };

/** Each breakdown row as [label, value]. */
function rows(): string[][] {
  return [...document.querySelectorAll("section > div > div > div")].map((r) => [...r.children].map((c) => c.textContent ?? ""));
}

describe("the coach card", () => {
  test("shows the step, heading and text", () => {
    render(<CoachCard {...base} />);
    expect(screen.getByText("2 / 17")).toBeTruthy();
    expect(screen.getByText("Your move")).toBeTruthy();
    expect(screen.getByText("Close your first square.")).toBeTruthy();
  });

  test("breaks down a turn with a square", () => {
    const score = factsFor(1).score;
    render(<CoachCard {...base} breakdown={score} />);
    expect(rows()).toContainEqual(["NITS", String(factsFor(1).score.words.find((w) => w.word === "NITS")?.points)]);
    expect(rows()).toContainEqual(["3×3 square", "+33"]);
    expect(screen.getByText("Total").nextElementSibling?.textContent).toBe("53");
  });

  test("shows a multiplier and a long word row", () => {
    const score = factsFor(2).score;
    render(<CoachCard {...base} breakdown={score} />);
    expect(rows()).toContainEqual(["EMO 3 ×3", "9"]);
    expect(rows()).toContainEqual(["Long word", "+5"]);
  });

  test("Next and leave call back", () => {
    const onNext = vi.fn();
    const onLeave = vi.fn();
    render(<CoachCard {...base} onNext={onNext} onLeave={onLeave} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave tutorial" }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  test("has no Next without a handler", () => {
    render(<CoachCard {...base} />);
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  test("has no accessibility violations", async () => {
    const { container } = render(<CoachCard {...base} error onNext={() => {}} breakdown={factsFor(1).score} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("describeFeedback", () => {
  test("a tile one square from its ghost", () => {
    expect(describeFeedback({ kind: "offGhost", letter: "B", x: 10, y: 10, target: { x: 9, y: 10 } })).toBe(
      "The B goes on the glowing square one square left.",
    );
    expect(describeFeedback({ kind: "offGhost", letter: "B", x: 9, y: 9, target: { x: 9, y: 10 } })).toContain("one square down.");
  });
  test("a tile farther away", () => {
    expect(describeFeedback({ kind: "offGhost", letter: "B", x: 1, y: 1, target: { x: 9, y: 10 } })).toBe(
      "The B goes on the glowing square marked B.",
    );
  });
  test("wrong letter and missing", () => {
    expect(describeFeedback({ kind: "wrongLetter", x: 1, y: 1, placed: "A", wanted: "B" })).toBe("That square wants B, not A.");
    expect(describeFeedback({ kind: "missing", count: 1 })).toBe("1 more tile to place.");
    expect(describeFeedback({ kind: "missing", count: 3 })).toBe("3 more tiles to place.");
    expect(describeFeedback({ kind: "ready" })).toBe("");
  });
});
