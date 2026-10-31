import { describe, expect, test } from "vitest";
import { moveToPosition, slotAt, slotOffset } from "./rackGeometry";

describe("moveToPosition", () => {
  test("moves a tile to the position asked for", () => {
    expect(moveToPosition([0, 1, 2, 3], [], 0, 2)).toEqual([1, 2, 0, 3]);
  });

  test("moves a tile leftwards", () => {
    expect(moveToPosition([0, 1, 2, 3], [], 3, 1)).toEqual([0, 3, 1, 2]);
  });

  test("appends when the position is past the end", () => {
    expect(moveToPosition([0, 1, 2], [], 0, 99)).toEqual([1, 2, 0]);
  });

  test("counts positions among visible tiles only", () => {
    // 1 is staged, so the visible tiles are 0, 2, 3. Position 1 is between
    // 0 and 2, not "after the hidden tile".
    expect(moveToPosition([0, 1, 2, 3], [1], 3, 1)).toEqual([0, 3, 2, 1]);
  });

  test("keeps staged tiles after the visible ones", () => {
    const result = moveToPosition([0, 1, 2, 3], [1, 2], 3, 0);
    expect(result.slice(0, 2)).toEqual([3, 0]);
    expect(result.slice(2).sort()).toEqual([1, 2]);
  });

  test("leaves the order alone when the tile is not visible", () => {
    expect(moveToPosition([0, 1, 2], [1], 1, 0)).toEqual([0, 1, 2]);
  });
});

describe("slotOffset", () => {
  test("counts slots across and down, row by row", () => {
    expect(slotOffset(0, 3, 2)).toEqual({ x: 1, y: 1 });
    expect(slotOffset(3, 0, 2)).toEqual({ x: -1, y: -1 });
    expect(slotOffset(1, 2, 2)).toEqual({ x: -1, y: 1 });
  });

  test("with no columns everything is one row", () => {
    expect(slotOffset(0, 3, 0)).toEqual({ x: 3, y: 0 });
  });
});

describe("slotAt", () => {
  const grid = [0, 1, 2, 3].map((i) => ({
    left: 100 + (i % 2) * 44,
    top: 10 + Math.floor(i / 2) * 44,
    width: 40,
    height: 40,
  }));

  test("finds the slot a point is centred in, across rows", () => {
    expect(slotAt(120, 74, grid)).toBe(2);
    expect(slotAt(164, 74, grid)).toBe(3);
  });

  test("right of the last slot on a row gives the end of that row", () => {
    expect(slotAt(300, 30, grid)).toBe(2);
  });

  test("left of everything gives 0", () => {
    expect(slotAt(0, 30, grid)).toBe(0);
  });

  test("below the last row gives the slot count", () => {
    expect(slotAt(120, 200, grid)).toBe(4);
  });

  const row = [0, 1, 2].map((i) => ({ left: 10 + i * 44, top: 5, width: 40, height: 40 }));

  test("a single row only reads x", () => {
    expect(slotAt(0, 500, row)).toBe(0);
    expect(slotAt(30, 500, row)).toBe(0);
    expect(slotAt(60, 0, row)).toBe(1);
    expect(slotAt(500, 20, row)).toBe(3);
  });
});
