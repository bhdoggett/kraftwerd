import { describe, expect, test } from "vitest";
import { moveStagedTo, stageAt } from "./staging";

const tile = (x: number, y: number, letter: string) => ({
  x,
  y,
  letter,
  isBlank: false,
  from: { kind: "letter" as const, index: letter.charCodeAt(0) },
});

describe("staging a tile", () => {
  test("an empty square just takes the tile", () => {
    const after = stageAt([tile(0, 0, "A")], tile(1, 0, "B"));
    expect(after.map((p) => p.letter)).toEqual(["A", "B"]);
  });

  test("a square that is taken gives its tile up", () => {
    const after = stageAt([tile(0, 0, "A"), tile(1, 0, "B")], tile(1, 0, "C"));

    // B is gone from the board, which is what puts it back on the rack.
    expect(after.map((p) => p.letter)).toEqual(["A", "C"]);
    expect(after.filter((p) => p.x === 1 && p.y === 0)).toHaveLength(1);
  });
});

describe("moving a staged tile", () => {
  test("an empty square takes it, and it leaves where it was", () => {
    const after = moveStagedTo([tile(0, 0, "A")], { x: 0, y: 0 }, 3, 4);
    expect(after).toEqual([{ ...tile(0, 0, "A"), x: 3, y: 4 }]);
  });

  test("dropping one staged tile on another sends that one back", () => {
    const after = moveStagedTo([tile(0, 0, "A"), tile(1, 0, "B")], { x: 0, y: 0 }, 1, 0);

    expect(after.map((p) => p.letter)).toEqual(["A"]);
    expect(after[0]).toMatchObject({ x: 1, y: 0 });
  });

  test("moving a tile that is not there changes nothing", () => {
    const pending = [tile(0, 0, "A")];
    expect(moveStagedTo(pending, { x: 9, y: 9 }, 1, 1)).toEqual(pending);
  });

  test("dropping a tile back where it already is leaves it alone", () => {
    const pending = [tile(2, 2, "A")];
    expect(moveStagedTo(pending, { x: 2, y: 2 }, 2, 2)).toEqual(pending);
  });
});
