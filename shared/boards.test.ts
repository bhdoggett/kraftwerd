import { describe, expect, test } from "vitest";
import { BOARD_LAYOUTS, shapeOf } from "./boards.js";

describe.each(BOARD_LAYOUTS)("$name", (layout) => {
  const shape = shapeOf(layout);
  const size = shape.size;
  const blocked = (x: number, y: number) => shape.blocked.has(`${x},${y}`);

  test("is an odd-sided square, so it has a true centre", () => {
    expect(layout.rows).toHaveLength(15);
    for (const row of layout.rows) expect(row).toHaveLength(15);
    expect(size % 2).toBe(1);
  });

  test("uses only the two characters the picture is drawn with", () => {
    for (const row of layout.rows) expect(row).toMatch(/^[.#]+$/);
  });

  test("has 180-degree rotational symmetry, as a crossword grid does", () => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        expect({ x, y, blocked: blocked(x, y) }).toEqual({
          x,
          y,
          blocked: blocked(size - 1 - x, size - 1 - y),
        });
      }
    }
  });

  test("leaves the centre open, since the first word must cover it", () => {
    expect(blocked(shape.centre.x, shape.centre.y)).toBe(false);
  });

  test("blocks between 5% and 20% of the board", () => {
    const share = shape.blocked.size / (size * size);
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.2);
  });

  test("leaves every open square reachable from every other", () => {
    const open: string[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (!blocked(x, y)) open.push(`${x},${y}`);
    }

    const seen = new Set([open[0]!]);
    const queue = [open[0]!];
    while (queue.length > 0) {
      const [x, y] = queue.pop()!.split(",").map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x! + dx!;
        const ny = y! + dy!;
        const key = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (blocked(nx, ny) || seen.has(key)) continue;
        seen.add(key);
        queue.push(key);
      }
    }

    // An unreachable pocket would be a region nobody could ever play in.
    expect(seen.size).toBe(open.length);
  });

  test("never blocks a square adjacent to the centre", () => {
    const { x, y } = shape.centre;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      expect(blocked(x + dx!, y + dy!)).toBe(false);
    }
  });
});
