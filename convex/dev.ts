import { ConvexError, v } from "convex/values";
import { GAME } from "../shared/config.js";
import { drawInto } from "./games";
import { env, mutation, query, type MutationCtx } from "./_generated/server";
import { requireUser } from "./auth_helpers";

/**
 * Helpers for exercising multiplayer alone.
 *
 * Everything here is gated on DEV_TOOLS, which is only set on a development
 * deployment. Production has no such variable, so these cannot run there even
 * though they are public functions — worth being strict about, since they
 * fabricate users and take other people's turns.
 */
function requireDevTools() {
  if (env.DEV_TOOLS !== "1") {
    throw new ConvexError("Dev tools are not enabled on this deployment");
  }
}

export const enabled = query({
  args: {},
  handler: async () => env.DEV_TOOLS === "1",
});

const STAND_INS = ["Robin Test", "Sam Test", "Alex Test"];

/** The stand-in with this name, created on first use. */
async function standIn(ctx: MutationCtx, name: string) {
  const authId = `dev|${name.toLowerCase().replace(/\s+/g, "-")}`;

  const existing = await ctx.db
    .query("users")
    .withIndex("by_authId", (q) => q.eq("authId", authId))
    .unique();
  if (existing !== null) return existing;

  const id = await ctx.db.insert("users", {
    authId,
    name,
    email: `${authId.replace("|", ".")}@example.test`,
  });
  return await ctx.db.get("users", id);
}

/** Create stand-in players and befriend them, so the friends list has entries. */
export const seedFriends = mutation({
  args: {},
  handler: async (ctx) => {
    requireDevTools();
    const me = await requireUser(ctx);

    for (const name of STAND_INS) {
      const user = await standIn(ctx, name);
      if (user === null) continue;

      const existing = await ctx.db
        .query("friendships")
        .withIndex("by_pair", (q) => q.eq("requesterId", me).eq("addresseeId", user._id))
        .unique();

      if (existing === null) {
        await ctx.db.insert("friendships", {
          requesterId: me,
          addresseeId: user._id,
          status: "accepted",
        });
      }
    }
    return null;
  },
});

/** Make every stand-in accept its invitation, so the game can start. */
export const acceptInvites = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    requireDevTools();
    await requireUser(ctx);

    const game = await ctx.db.get("games", args.gameId);
    if (game === null) throw new ConvexError("No such game");

    const players = await ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .take(GAME.maxPlayers);

    for (const player of players) {
      if (player.status !== "invited") continue;
      const user = await ctx.db.get("users", player.userId);
      if (user?.authId.startsWith("dev|") !== true) continue;
      await ctx.db.patch("players", player._id, { status: "joined" });
    }

    const after = await ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .take(GAME.maxPlayers);

    if (
      after.length === game.playerCount &&
      after.every((p) => p.status !== "invited")
    ) {
      await ctx.db.patch("games", args.gameId, { status: "active" });
    }
    return null;
  },
});

/** Seat stand-ins in any empty seats of a link-filled game and start it. */
export const fillSeats = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    requireDevTools();
    await requireUser(ctx);

    const game = await ctx.db.get("games", args.gameId);
    if (game === null) throw new ConvexError("No such game");
    if (game.status !== "lobby") throw new ConvexError("That game has already started");

    const players = await ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .take(GAME.maxPlayers);

    let seat = players.length;
    for (const name of STAND_INS) {
      if (seat >= game.playerCount) break;
      const user = await standIn(ctx, name);
      if (user === null || players.some((p) => p.userId === user._id)) continue;

      // From the game's bag, like any other seat: a stand-in dealt tiles from
      // nowhere would leave the bag counting tiles that are in someone's hand.
      const rack = await drawInto(ctx, args.gameId, []);
      await ctx.db.insert("players", {
        gameId: args.gameId,
        userId: user._id,
        seat,
        score: 0,
        letters: rack.letters,
        blank: true,
        status: "joined",
      });
      seat++;
    }

    if (seat >= game.playerCount) {
      await ctx.db.patch("games", args.gameId, { status: "active" });
    }
    return null;
  },
});

/**
 * Pass the turn on behalf of a stand-in, so turn order can be exercised
 * without a second browser. Refuses to pass for a real player.
 */
export const passForStandIn = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    requireDevTools();
    await requireUser(ctx);

    const game = await ctx.db.get("games", args.gameId);
    if (game === null) throw new ConvexError("No such game");
    if (game.status !== "active") throw new ConvexError("Game is not active");

    const current = await ctx.db
      .query("players")
      .withIndex("by_game_and_seat", (q) =>
        q.eq("gameId", args.gameId).eq("seat", game.currentSeat),
      )
      .unique();
    if (current === null) throw new ConvexError("No player in that seat");

    const user = await ctx.db.get("users", current.userId);
    if (user?.authId.startsWith("dev|") !== true) {
      throw new ConvexError("That seat belongs to a real player");
    }

    await ctx.db.patch("games", args.gameId, {
      turnNumber: game.turnNumber + 1,
      currentSeat: (game.currentSeat + 1) % game.playerCount,
    });
    return null;
  },
});
