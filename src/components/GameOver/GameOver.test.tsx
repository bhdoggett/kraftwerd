import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "../../../convex/_generated/dataModel";
import { GameOverDialog, headline } from "./GameOver";

afterEach(cleanup);

describe("the game-over headline", () => {
  test("says you won", () => {
    expect(headline({ youWon: true, winners: ["Ana"] })).toBe("You won!");
  });

  test("names somebody else's win", () => {
    expect(headline({ youWon: false, winners: ["Bo"] })).toBe("Bo won");
  });

  test("says a tie is a tie", () => {
    expect(headline({ youWon: false, winners: ["Bo", "Cy"] })).toBe("Bo and Cy tied");
    expect(headline({ youWon: true, winners: ["Ana", "Bo"] })).toBe("You tied for the win!");
  });
});

describe("the game-over dialog", () => {
  const result = {
    gameId: "g1" as Id<"games">,
    youWon: false,
    winners: ["Bo"],
    scores: [
      { name: "Bo", score: 120, you: false },
      { name: "Ana", score: 98, you: true },
    ],
  };

  test("lists everyone's score, you as You", () => {
    render(<GameOverDialog result={result} onView={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Bo won")).toBeDefined();
    expect(screen.getByText("You")).toBeDefined();
    expect(screen.getByText("98")).toBeDefined();
  });

  test("View results and Close each do their own thing", () => {
    const onView = vi.fn();
    const onClose = vi.fn();
    render(<GameOverDialog result={result} onView={onView} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "View results" }));
    expect(onView).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
