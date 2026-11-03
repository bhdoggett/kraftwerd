import { describe, expect, test } from "vitest";
import { moveToPosition } from "./rackGeometry";

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
