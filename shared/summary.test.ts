import { describe, expect, test } from "vitest";
import { summarizeGame, type SummaryTurn } from "./summary";

const play = (
  turnNumber: number,
  userId: string,
  cells: [number, number][],
  score: number,
  extra: Partial<SummaryTurn> = {},
): SummaryTurn => ({
  turnNumber,
  userId,
  kind: "play",
  placements: cells.map(([x, y]) => ({ x, y })),
  words: ["WORD"],
  squares: [],
  score,
  ...extra,
});

describe("summarizeGame", () => {
  test("counts turns, tiles and points a player at a time", () => {
    const [a, b] = summarizeGame(
      [
        play(
          1,
          "a",
          [
            [0, 0],
            [1, 0],
          ],
          6,
        ),
        { ...play(2, "b", [], 0), kind: "pass" },
        play(3, "a", [[2, 0]], 4),
        { ...play(4, "b", [], 0), kind: "trade" },
      ],
      ["a", "b"],
    );

    expect(a).toMatchObject({
      turns: 2,
      tilesPlayed: 3,
      points: 10,
      passes: 0,
    });
    expect(b).toMatchObject({ turns: 2, tilesPlayed: 0, passes: 1, trades: 1 });
    expect(b.bestPlay).toBeNull();
  });

  test("a stack is credited to whoever laid the tile on top", () => {
    const [a, b] = summarizeGame(
      [
        play(
          1,
          "a",
          [
            [0, 0],
            [1, 0],
          ],
          5,
        ),
        play(
          2,
          "b",
          [
            [0, 0],
            [5, 5],
          ],
          7,
        ),
      ],
      ["a", "b"],
    );

    expect(a.stacks).toBe(0);
    expect(b.stacks).toBe(1);
  });

  test("walks the turns in order, whatever order they arrive in", () => {
    const [, b] = summarizeGame(
      [play(2, "b", [[0, 0]], 3), play(1, "a", [[0, 0]], 2)],
      ["a", "b"],
    );

    expect(b.stacks).toBe(1);
  });

  test("best play is the highest score, the earlier one on a tie", () => {
    const [a] = summarizeGame(
      [
        play(1, "a", [[0, 0]], 9, { words: ["FIRST"] }),
        play(2, "a", [[1, 0]], 12, { words: ["TOP", "UP"] }),
        play(3, "a", [[2, 0]], 12, { words: ["LATER"] }),
      ],
      ["a"],
    );

    expect(a.bestPlay).toEqual({
      turnNumber: 2,
      words: ["TOP", "UP"],
      score: 12,
    });
  });

  test("counts every 3x3 a play completes", () => {
    const [a] = summarizeGame(
      [play(1, "a", [[0, 0]], 40, { squares: [3, 3] })],
      ["a"],
    );

    expect(a.squares).toBe(2);
  });

  test("rows written before kinds were recorded are plays", () => {
    const old = play(1, "a", [[0, 0]], 5);
    delete old.kind;

    expect(summarizeGame([old], ["a"])[0].tilesPlayed).toBe(1);
  });
});
