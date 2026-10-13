import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { PlayerSummary } from "../../../shared/summary";
import { average } from "./figures";
import { GameSummary } from "./GameSummary";

afterEach(cleanup);

const row = (
  userId: string,
  extra: Partial<PlayerSummary> = {},
): PlayerSummary => ({
  userId,
  turns: 4,
  passes: 0,
  trades: 0,
  points: 30,
  tilesPlayed: 12,
  stacks: 1,
  squares: 0,
  bestPlay: { turnNumber: 1, words: ["WORD"], score: 12 },
  ...extra,
});

const players = [
  { userId: "a", seat: 0, name: "Ann", isYou: true },
  { userId: "b", seat: 1, name: "Bob", isYou: false },
];

describe("average", () => {
  test("is points a turn, to one place", () => {
    expect(average({ points: 10, turns: 3 })).toBe("3.3");
  });

  test("is a dash for nobody who moved", () => {
    expect(average({ points: 0, turns: 0 })).toBe("–");
  });
});

describe("GameSummary", () => {
  test("shows each figure a player at a time", () => {
    render(
      <GameSummary
        summary={[
          row("a", { stacks: 3, squares: 2 }),
          row("b", { tilesPlayed: 9 }),
        ]}
        players={players}
      />,
    );

    const stacks = screen.getByRole("row", { name: /Stacks/ });
    expect(
      within(stacks)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["3", "1"]);
    const squares = screen.getByRole("row", { name: /3x3s/ });
    expect(within(squares).getAllByRole("cell")[0].textContent).toBe("2");
    expect(screen.getByText("You")).toBeTruthy();
  });
});
