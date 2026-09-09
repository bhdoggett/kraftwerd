import { describe, expect, test } from "vitest";
import { BOT_NAMES, GAME } from "../../shared/config";
import { drawBotNames, seatsSpare } from "./roster";

/** A rigged rng: hands back the numbers given, then zeroes forever. */
const rigged = (...values: number[]) => {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0);
};

describe("naming the machines", () => {
  test("draws the number asked for", () => {
    expect(drawBotNames(3, Math.random)).toHaveLength(3);
  });

  test("draws names from the pool and nothing else", () => {
    for (const name of drawBotNames(3, Math.random)) {
      expect(BOT_NAMES).toContain(name);
    }
  });

  test("never seats two machines under one name", () => {
    // Every table, at every size, a hundred times over: a rigged draw would
    // have to be very unlucky to repeat, so this leans on the real rng.
    for (let i = 0; i < 100; i++) {
      const drawn = drawBotNames(GAME.maxPlayers - 1, Math.random);
      expect(new Set(drawn).size).toBe(drawn.length);
    }
  });

  test("avoids the names already at the table", () => {
    const taken = BOT_NAMES.slice(0, BOT_NAMES.length - 1);
    // Only one name left unspoken for, so the draw has no choice but to find
    // it -- which is the case that catches an exclusion that does not work.
    expect(drawBotNames(1, Math.random, taken)).toEqual([
      BOT_NAMES[BOT_NAMES.length - 1],
    ]);
  });

  test("the same rng draws the same names, so a test can pin them", () => {
    const draw = () => drawBotNames(2, rigged(0, 0));
    expect(draw()).toEqual(draw());
  });

  test("asking for more names than exist gives back every one, once", () => {
    const drawn = drawBotNames(BOT_NAMES.length + 5, Math.random);
    expect(new Set(drawn).size).toBe(BOT_NAMES.length);
  });
});

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
