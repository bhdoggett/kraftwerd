/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import ALL_WORDS from "../shared/data/words.json" with { type: "json" };
import { makeDictionary } from "../shared/engine/dictionary";
import { NAMES } from "../shared/names";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const FULL = makeDictionary(ALL_WORDS);
const RACK = ["C", "A", "T", "S", "E", "R", "O"];

async function table(hints: boolean) {
  const t = convexTest(schema, modules);
  const alice = await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "auth|bob", name: "Bob" });
    return await ctx.db.insert("users", { authId: "auth|alice", name: "Alice" });
  });
  const asAlice = t.withIdentity({ subject: "auth|alice" });
  const { gameId } = await asAlice.mutation(api.games.createGame, {
    playerCount: 2,
    bots: [{ level: "easy", name: NAMES[0] }],
    hints,
  });
  await t.run(async (ctx) => {
    await ctx.db.patch("games", gameId, { status: "active", currentSeat: 0 });
    const mine = await ctx.db
      .query("players")
      .withIndex("by_game_and_user", (q) => q.eq("gameId", gameId).eq("userId", alice))
      .unique();
    await ctx.db.patch("players", mine!._id, { letters: [...RACK], blanks: 0 });
  });
  return { t, asAlice, gameId };
}

describe("coach.hints", () => {
  test("up to three moves from your own rack, every word a word", async () => {
    const { asAlice, gameId } = await table(true);
    const result = await asAlice.action(api.coach.hints, { gameId });

    expect(result.turnNumber).toBe(0);
    expect(result.moves.length).toBeGreaterThan(0);
    expect(result.moves.length).toBeLessThanOrEqual(3);
    for (const move of result.moves) {
      const left = [...RACK];
      for (const p of move.placements) {
        expect(p.isBlank).toBe(false);
        const i = left.indexOf(p.letter);
        expect(i).toBeGreaterThanOrEqual(0);
        left.splice(i, 1);
      }
      for (const w of move.words) expect(FULL.has(w.word)).toBe(true);
    }
    expect(result.rackWords.length).toBeGreaterThan(0);
  }, 120_000);

  test("asking twice in one turn searches once", async () => {
    const { t, asAlice, gameId } = await table(true);
    const first = await asAlice.action(api.coach.hints, { gameId });
    const second = await asAlice.action(api.coach.hints, { gameId });
    expect(second).toEqual(first);
    const rows = await t.run(async (ctx) => await ctx.db.query("hints").collect());
    expect(rows).toHaveLength(1);
  }, 120_000);

  test("refused in a game without hints", async () => {
    const { asAlice, gameId } = await table(false);
    await expect(asAlice.action(api.coach.hints, { gameId })).rejects.toThrow(
      "Hints are off in this game",
    );
  });

  test("refused when it is not your turn", async () => {
    const { t, asAlice, gameId } = await table(true);
    await t.run(async (ctx) => {
      await ctx.db.patch("games", gameId, { currentSeat: 1 });
    });
    await expect(asAlice.action(api.coach.hints, { gameId })).rejects.toThrow(
      "Hints are for your own turn",
    );
  });

  test("refused to someone not at the table", async () => {
    const { t, gameId } = await table(true);
    const asBob = t.withIdentity({ subject: "auth|bob" });
    await expect(asBob.action(api.coach.hints, { gameId })).rejects.toThrow(
      "You are not in this game",
    );
  });
});
