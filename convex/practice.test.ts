/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { NAMES } from "../shared/names";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const CENTRE = 7;
const at = (x: number, letter: string) => ({
  x: CENTRE + x,
  y: CENTRE,
  letter,
  isBlank: false,
});

async function botGame(hints: boolean) {
  const t = convexTest(schema, modules);
  const alice = await t.run(async (ctx) => {
    for (const word of ["CAT"]) await ctx.db.insert("words", { word });
    return await ctx.db.insert("users", {
      authId: "auth|alice",
      displayName: "Alice",
    });
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
      .withIndex("by_game_and_user", (q) =>
        q.eq("gameId", gameId).eq("userId", alice),
      )
      .unique();
    await ctx.db.patch("players", mine!._id, {
      letters: ["C", "A", "T", "E", "E", "E", "E"],
    });
  });
  return { t, asAlice, alice, gameId };
}

const userRow = (
  t: Awaited<ReturnType<typeof botGame>>["t"],
  id: Id<"users">,
) => t.run(async (ctx) => await ctx.db.get("users", id));

describe("practice games", () => {
  test("hints are refused when a seat waits for a person", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "auth|alice", displayName: "Alice" });
    });
    const asAlice = t.withIdentity({ subject: "auth|alice" });
    await expect(
      asAlice.mutation(api.games.createGame, { playerCount: 2, hints: true }),
    ).rejects.toThrow("Hints are only for games against the computer");
    await expect(
      asAlice.mutation(api.games.createGame, { playerCount: 1, hints: true }),
    ).rejects.toThrow("Hints are only for games against the computer");
  });

  test("a game against bots can have hints", async () => {
    const { t, gameId } = await botGame(true);
    const game = await t.run(async (ctx) => await ctx.db.get("games", gameId));
    expect(game?.hints).toBe(true);
  });

  test("a best turn in a practice game is not recorded", async () => {
    const { t, asAlice, alice, gameId } = await botGame(true);
    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(-1, "C"), at(0, "A"), at(1, "T")],
    });
    expect((await userRow(t, alice))?.bestTurnScore ?? 0).toBe(0);
  });

  test("a best turn in an ordinary game still is", async () => {
    const { t, asAlice, alice, gameId } = await botGame(false);
    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(-1, "C"), at(0, "A"), at(1, "T")],
    });
    expect((await userRow(t, alice))?.bestTurnScore ?? 0).toBeGreaterThan(0);
  });

  test("a finished practice game counts toward nothing", async () => {
    const { t, asAlice, alice, gameId } = await botGame(true);
    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(-1, "C"), at(0, "A"), at(1, "T")],
    });
    await asAlice.mutation(api.games.resignGame, { gameId });
    const user = await userRow(t, alice);
    expect(user?.gamesPlayed ?? 0).toBe(0);
    expect(user?.wins ?? 0).toBe(0);
    expect(user?.bestGameScore ?? 0).toBe(0);
  });

  test("a finished ordinary game still counts", async () => {
    const { t, asAlice, alice, gameId } = await botGame(false);
    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(-1, "C"), at(0, "A"), at(1, "T")],
    });
    await asAlice.mutation(api.games.resignGame, { gameId });
    expect((await userRow(t, alice))?.gamesPlayed ?? 0).toBe(1);
  });

  test("a rematch of a practice game is a practice game", async () => {
    const { t, asAlice, gameId } = await botGame(true);
    await t.run(async (ctx) => {
      await ctx.db.patch("games", gameId, { status: "finished" });
    });
    const { gameId: again } = await asAlice.mutation(api.games.rematch, {
      gameId,
    });
    const game = await t.run(async (ctx) => await ctx.db.get("games", again));
    expect(game?.hints).toBe(true);
  });

  test("the lobby says which games are practice", async () => {
    const { asAlice } = await botGame(true);
    const mine = await asAlice.query(api.games.listMyGames, {});
    expect(mine.games.map((g) => g.hints)).toEqual([true]);
  });
});
