import { describe, expect, test } from "vitest";
import { botLabel, seatsFree, trimRoster } from "./roster";

const roster = (friends: string[], bots: ("easy" | "medium" | "hard")[]) => ({
  friends,
  bots,
});

describe("seats left to fill", () => {
  test("counts the seats nobody holds yet", () => {
    // Four players: you, one friend, one bot -- one seat spare.
    expect(seatsFree(roster(["ann"], ["easy"]), 4)).toBe(1);
  });

  test("a table with everyone chosen has none", () => {
    expect(seatsFree(roster(["ann", "bo"], []), 3)).toBe(0);
  });

  test("your own seat is never free", () => {
    expect(seatsFree(roster([], []), 1)).toBe(0);
  });
});

describe("shrinking the game", () => {
  test("drops the machines before the people", () => {
    const after = trimRoster(roster(["ann"], ["easy", "hard"]), 2);
    expect(after).toEqual(roster(["ann"], []));
  });

  test("drops people only once no bots are left", () => {
    const after = trimRoster(roster(["ann", "bo"], ["easy"]), 2);
    expect(after).toEqual(roster(["ann"], []));
  });

  test("a roster that already fits is left alone", () => {
    const before = roster(["ann"], ["hard"]);
    expect(trimRoster(before, 3)).toEqual(before);
  });

  test("going solo empties the table", () => {
    expect(trimRoster(roster(["ann"], ["easy"]), 1)).toEqual(roster([], []));
  });
});

describe("what a bot is called", () => {
  test("matches the seat it will take, so the lobby agrees with the game", () => {
    // Bots fill seats 1 upwards; seat 0 is yours.
    expect(botLabel(0)).toBe("Sam");
    expect(botLabel(1)).toBe("Ash");
  });
});
