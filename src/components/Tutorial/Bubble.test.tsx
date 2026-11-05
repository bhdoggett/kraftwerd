import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Bubble } from "./Bubble";

/** A phone-sized board: 360px across, 15 squares of 24px. */
const AREA = { left: 0, top: 0, width: 360, height: 360 };
const CELL = 24;
const BUBBLE = { width: 272, height: 60 };

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
}

/** Lays out the board area, its squares and the bubble as a 390px phone would. */
function layOut() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.getAttribute("data-area") !== null) return rect(AREA.left, AREA.top, AREA.width, AREA.height);
    const cell = this.getAttribute("data-cell");
    if (cell !== null) {
      const [x, y] = cell.split(",").map(Number);
      return rect(x * CELL, y * CELL, CELL, CELL);
    }
    if (this.getAttribute("role") === "status") return rect(0, 0, BUBBLE.width, BUBBLE.height);
    return rect(0, 0, 0, 0);
  });
}

function drawAt(cell: string, prefer?: "above" | "below" | "left" | "right") {
  const squares: string[] = [];
  for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) squares.push(`${x},${y}`);
  render(
    <div data-area="">
      {squares.map((k) => (
        <span key={k} data-cell={k} />
      ))}
      <Bubble cell={cell} text="A line" prefer={prefer} />
    </div>,
  );
  const style = screen.getByRole("status").style;
  return { left: parseFloat(style.left), top: parseFloat(style.top), side: screen.getByRole("status").dataset.side };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Bubble", () => {
  test("never runs off the board, whatever side it ends up on", () => {
    layOut();
    for (const prefer of ["above", "below", "left", "right"] as const) {
      for (const cell of ["0,0", "14,0", "0,14", "14,14", "7,7", "11,3", "12,4"]) {
        const at = drawAt(cell, prefer);
        expect(at.left, `${cell} ${prefer}`).toBeGreaterThanOrEqual(0);
        expect(at.left + BUBBLE.width, `${cell} ${prefer}`).toBeLessThanOrEqual(AREA.width);
        cleanup();
      }
    }
  });

  test("sits beside its square, not on it", () => {
    layOut();
    for (const cell of ["11,3", "12,4", "7,7", "13,13"]) {
      const at = drawAt(cell, "left");
      const [x, y] = cell.split(",").map(Number);
      const overlaps =
        at.left < (x + 1) * CELL && at.left + BUBBLE.width > x * CELL && at.top < (y + 1) * CELL && at.top + BUBBLE.height > y * CELL;
      expect(overlaps, `${cell} went ${at.side}`).toBe(false);
      cleanup();
    }
  });
});
