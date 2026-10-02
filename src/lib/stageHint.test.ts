import { describe, expect, test } from "vitest";
import { shownHint, stageHint } from "./stageHint";

const p = (x: number, letter: string, isBlank = false) => ({ x, y: 7, letter, isBlank });

describe("stageHint", () => {
  test("each placement takes its own rack tile, duplicates included", () => {
    expect(stageHint([p(6, "E"), p(7, "E")], ["E", "T", "E"])).toEqual([
      { ...p(6, "E"), from: { kind: "letter", index: 0 } },
      { ...p(7, "E"), from: { kind: "letter", index: 2 } },
    ]);
  });

  test("a blank comes from the blanks, whatever it stands for", () => {
    expect(stageHint([p(6, "Q", true)], ["A"])).toEqual([
      { ...p(6, "Q", true), from: { kind: "blank" } },
    ]);
  });

  test("a hint the rack no longer holds is refused", () => {
    expect(stageHint([p(6, "Z")], ["A"])).toBeNull();
  });
});

describe("shownHint", () => {
  const result = { turnNumber: 4, moves: [], rackWords: [] };
  test("shown on the turn it was asked for", () => {
    expect(shownHint(result, 4)).toBe(result);
  });
  test("dropped once the turn has moved on", () => {
    expect(shownHint(result, 5)).toBeNull();
  });
});
