import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MiniBoard } from "./MiniBoard";

afterEach(cleanup);

/** The squares, in reading order, as the diagram draws them. */
function squares(container: HTMLElement) {
  return [...container.querySelectorAll("[data-seat]")].map((el) => ({
    letter: el.textContent,
    seat: el.getAttribute("data-seat"),
    full: el.getAttribute("data-stack") === "2",
  }));
}

describe("a position drawn from a real game", () => {
  test("gives each square the seat it is told, letter by letter", () => {
    const { container } = render(
      <MiniBoard rows={["AB"]} seats={{ "0,0": 0, "1,0": 1 }} />,
    );

    expect(squares(container)).toEqual([
      { letter: "A", seat: "0", full: false },
      { letter: "B", seat: "1", full: false },
    ]);
  });

  test("falls back to the one colour where no seat is named", () => {
    const { container } = render(
      <MiniBoard rows={["AB"]} seat={3} seats={{ "1,0": 0 }} />,
    );

    expect(squares(container).map((s) => s.seat)).toEqual(["3", "0"]);
  });

  test("a square built on is full, whoever's colour it wears", () => {
    const { container } = render(
      <MiniBoard rows={["AB"]} seats={{ "0,0": 0, "1,0": 1 }} full={["1,0"]} />,
    );

    expect(squares(container).map((s) => s.full)).toEqual([false, true]);
  });

  test("named seats win over the played-this-turn colour", () => {
    const { container } = render(
      <MiniBoard rows={["AB"]} played={["0,0"]} seats={{ "0,0": 1 }} />,
    );

    expect(squares(container)[0]?.seat).toBe("1");
  });
});
