import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GAME } from "../../../shared/config";
import { PracticeDialog } from "./Practice";
import { axeViolations } from "../../test/axe";

afterEach(cleanup);

const dialog = (onStart = vi.fn()) =>
  render(<PracticeDialog onStart={onStart} onCancel={vi.fn()} starting={false} error={null} />);

describe("the practice dialog", () => {
  test("offers a color and 2 to maxPlayers players", () => {
    dialog();
    expect(screen.getByRole("group", { name: "Choose your color" })).toBeDefined();
    for (let n = 2; n <= GAME.maxPlayers; n++) {
      expect(screen.getByRole("button", { name: `${n} players` })).toBeDefined();
    }
    expect(screen.queryByRole("button", { name: `${GAME.maxPlayers + 1} players` })).toBeNull();
    expect(screen.getByText("Robots, with hints. Doesn’t count toward your record.")).toBeDefined();
  });

  test("starts a two-player game in the first color by default", () => {
    const onStart = vi.fn();
    dialog(onStart);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onStart).toHaveBeenCalledWith(2, 0);
  });

  test("starts with the count and color picked", () => {
    const onStart = vi.fn();
    dialog(onStart);
    fireEvent.click(screen.getByRole("button", { name: "3 players" }));
    fireEvent.click(screen.getByRole("button", { name: "Seat 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onStart).toHaveBeenCalledWith(3, 2);
  });

  test("has no accessibility violations", async () => {
    dialog();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
