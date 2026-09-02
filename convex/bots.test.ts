/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Excludes test files: globbing them made each test module import the
// others, which reads as a dependency cycle and loads them needlessly.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const CENTRE = 7;

/**
 * A two-seat game with a machine next to the creator, and the words table
 * stocked with whatever this test wants in it.
 */
async function table(words: string[]) {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "auth|alice", name: "Alice" });
    for (const word of words) await ctx.db.insert("words", { word });
  });

  const asAlice = t.withIdentity({ subject: "auth|alice" });
  const { gameId } = await asAlice.mutation(api.games.createGame, {
    playerCount: 2,
    bots: ["hard"],
  });
  return { t, asAlice, gameId };
}

const seatsOf = (
  t: Awaited<ReturnType<typeof table>>["t"],
  gameId: Id<"games">,
) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("players")
        .withIndex("by_game", (q) => q.eq("gameId", gameId))
        .take(10)
    ).sort((a, b) => a.seat - b.seat),
  );

describe("the words table check", () => {
  test("it reports the words the table does not have, in one call", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const word of ["AD", "DO", "AT"]) await ctx.db.insert("words", { word });
    });

    expect(
      await t.query(internal.bots.wordsMissing, { words: ["AD", "DO"] }),
    ).toEqual([]);
    expect(
      await t.query(internal.bots.wordsMissing, { words: ["AD", "ZZZ", "QQ"] }),
    ).toEqual(expect.arrayContaining(["ZZZ", "QQ"]));
    expect(await t.query(internal.bots.wordsMissing, { words: [] })).toEqual([]);
  });

  test("a word repeated across a move is only looked up once", async () => {
    const t = convexTest(schema, modules);
    expect(
      await t.query(internal.bots.wordsMissing, { words: ["ZZZ", "ZZZ", "ZZZ"] }),
    ).toEqual(["ZZZ"]);
  });
});

describe("what a turn reads", () => {
  test("there is nothing to think about when the seat is a person's", async () => {
    const { t, gameId } = await table(["AD"]);
    // Seat 0 is the creator, and the game opens on it.
    expect(await t.query(internal.bots.turnState, { gameId })).toBeNull();
  });

  test("a bot's seat comes back with the board, the rack and the level", async () => {
    const { t, gameId } = await table(["AD"]);
    await t.run(async (ctx) => ctx.db.patch("games", gameId, { currentSeat: 1 }));

    const state = await t.query(internal.bots.turnState, { gameId });
    expect(state).not.toBeNull();
    expect(state!.level).toBe("hard");
    expect(state!.boardSize).toBe(15);
    expect(state!.tiles).toEqual([]);
    expect(state!.letters.length).toBeGreaterThan(0);
  });
});

/*
 * The two refusals the retry loop is built on. A bot's turn is no longer a
 * transaction, so what it decided may answer a board that has since moved; the
 * loop catches that and thinks again. These are what it catches.
 */
describe("a move that arrives too late", () => {
  test("a play for a seat that has moved on is refused", async () => {
    const { t, gameId } = await table(["AD"]);
    const [alice, bot] = await seatsOf(t, gameId);

    // The game is on seat 0. The machine at seat 1 tries to play anyway.
    await expect(
      t.mutation(internal.games.playForBot, {
        gameId,
        userId: bot.userId,
        placements: [
          { x: CENTRE, y: CENTRE, letter: "A", isBlank: false },
          { x: CENTRE + 1, y: CENTRE, letter: "D", isBlank: false },
        ],
      }),
    ).rejects.toThrow();
    expect(alice.seat).toBe(0);
  });

  test("a pass for a seat that has moved on writes nothing", async () => {
    const { t, gameId } = await table(["AD"]);
    const [, bot] = await seatsOf(t, gameId);

    await t.mutation(internal.games.playForBot, {
      gameId,
      userId: bot.userId,
      placements: [],
    });

    // Passing is the one move that does not go through `playTurn`, so nothing
    // else checks its seat. Without the check here, a bot overtaken by a
    // person would spend that person's turn instead of its own.
    const game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game!.currentSeat).toBe(0);
    expect(game!.turnNumber).toBe(0);
    const turns = await t.run(async (ctx) => ctx.db.query("turns").take(10));
    expect(turns).toEqual([]);
  });
});

describe("a turn taken outside a transaction", () => {
  test("a bot with nothing the table will accept passes rather than hanging", async () => {
    // The bundle offers moves; the table has a single word none of them can
    // be. So every candidate is refused, the search runs out, and the turn has
    // to end in something -- a pass, not a seat that never moves again.
    const { t, gameId } = await table(["ZZZZZZZ"]);
    const [, bot] = await seatsOf(t, gameId);
    await t.run(async (ctx) => ctx.db.patch("games", gameId, { currentSeat: 1 }));

    await t.action(internal.bots.takeTurn, { gameId });

    const game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game!.currentSeat).toBe(0);
    expect(game!.turnNumber).toBe(1);

    const turns = await t.run(async (ctx) => ctx.db.query("turns").take(10));
    expect(turns.map((turn) => turn.kind)).toEqual(["pass"]);
    expect(turns[0].userId).toBe(bot.userId);

    // Nothing landed on the board: the words table really did have the last
    // word, and the bot did not fall through to playing something anyway.
    const tiles = await t.run(async (ctx) => ctx.db.query("tiles").take(10));
    expect(tiles).toEqual([]);
  });

  test("a turn for a seat that is no longer a bot's writes nothing at all", async () => {
    const { t, gameId } = await table(["AD"]);
    // The game is on seat 0, which is a person's. Whatever scheduled this has
    // been overtaken; the turn must not pass on that person's behalf.
    await t.action(internal.bots.takeTurn, { gameId });

    const game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game!.currentSeat).toBe(0);
    expect(game!.turnNumber).toBe(0);
    expect(await t.run(async (ctx) => ctx.db.query("turns").take(10))).toEqual([]);
  });

  test("a finished game wakes nothing", async () => {
    const { t, gameId } = await table(["AD"]);
    await t.run(async (ctx) =>
      ctx.db.patch("games", gameId, { currentSeat: 1, status: "finished" }),
    );

    await t.action(internal.bots.takeTurn, { gameId });
    expect(await t.run(async (ctx) => ctx.db.query("turns").take(10))).toEqual([]);
  });
});
