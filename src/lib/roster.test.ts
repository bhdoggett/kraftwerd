import { describe, expect, test } from "vitest";
import { GAME } from "../../shared/config";
import { seatsSpare } from "./roster";

describe("seats a table of people still has spare", () => {
  test("counts what is left after you, the chosen, and the seats held open", () => {
    expect(seatsSpare(1, 1)).toBe(GAME.maxPlayers - 3);
  });

  test("a full table has none", () => {
    expect(seatsSpare(GAME.maxPlayers - 1, 0)).toBe(0);
  });

  test("never goes below nothing", () => {
    expect(seatsSpare(GAME.maxPlayers, GAME.maxPlayers)).toBe(0);
  });
});
