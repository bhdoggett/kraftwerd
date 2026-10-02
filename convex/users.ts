import { ConvexError, v } from "convex/values";
import { RULES_VERSION } from "../shared/config.js";
import { checkDisplayName, suggestDisplayName } from "../shared/names.js";
import { components } from "./_generated/api";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { googleConfigured } from "./auth";
import { currentUser } from "./auth_helpers";
import { deleteWholeGame, leaveGame, seatedAt } from "./games";

/**
 * What a row from before `rulesSeen` existed has seen: the rules that were
 * live when it was added.
 */
const RULES_SEEN_UNTRACKED = 9;

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", identity.subject))
      .unique();

    /*
     * A record from older rules reads as empty rather than as a score.
     *
     * It is cleared the next time a game finishes, but showing the old
     * numbers until then would be showing a best score that nothing can beat
     * -- it was set in a game nobody can play any more.
     */
    const current = (user?.statsVersion ?? 0) === RULES_VERSION;

    return user === null
      ? null
      : {
          id: user._id,
          /** What everybody else sees, once chosen. */
          displayName: user.displayName ?? null,
          /**
           * What Google calls them, and their address: theirs to see, so the
           * account page can say which account this is. Nobody else gets
           * either.
           */
          name: user.name ?? null,
          email: user.email ?? null,
          image: user.image ?? null,
          /** An account made to try the game, with no way back into it. */
          isGuest: user.isGuest === true,
          /**
           * Ask for a name before anything else. Not of a guest: they cannot
           * sit with other people, so there is nobody to show a name to, and
           * a guest is somebody who has not yet decided to stay.
           */
          needsDisplayName: user.isGuest !== true && !user.displayName,
          /** What the prompt starts from: their Google first name, if usable. */
          suggestedDisplayName: suggestDisplayName(user.name),
          /** The newest rules version this player has been told about. */
          rulesSeen: user.rulesSeen ?? RULES_SEEN_UNTRACKED,
          stats: {
            wins: current ? (user.wins ?? 0) : 0,
            gamesPlayed: current ? (user.gamesPlayed ?? 0) : 0,
            bestGameScore: current ? (user.bestGameScore ?? 0) : 0,
            bestTurnScore: current ? (user.bestTurnScore ?? 0) : 0,
          },
        };
  },
});

/** Lets the sign-in screen explain itself when Google is not set up yet. */
export const authStatus = query({
  args: {},
  handler: async () => ({ googleConfigured }),
});

/** The player has read what changed in the rules, up to the current version. */
export const acknowledgeRules = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (user.rulesSeen === RULES_VERSION) return null;
    await ctx.db.patch("users", user._id, { rulesSeen: RULES_VERSION });
    return null;
  },
});

/** Choose the name other players see. */
export const setDisplayName = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const checked = checkDisplayName(args.name);
    if (!checked.ok) throw new ConvexError(checked.reason);
    await ctx.db.patch("users", user._id, { displayName: checked.name });
    return null;
  },
});

/**
 * Delete the signed-in account.
 *
 * Games with other people in them are not deleted, because they are those
 * people's history too: a game still going is resigned or left the way the
 * Resign button would, and a finished one keeps its result. The row they
 * point at stays, emptied of everything that says who it was, and shows as
 * "Deleted player". Games with nobody else in them go entirely.
 *
 * Better Auth's own `deleteUser` refuses a session more than a day old, which
 * would be most of them, so its rows are removed here directly instead.
 */
export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await currentUser(ctx);

    // Read up front rather than walked lazily: leaving a game can delete the
    // very rows this index would go on to return.
    const seats = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .take(MAX_GAMES);
    if (seats.length === MAX_GAMES) {
      throw new ConvexError("Too many games to delete in one go. Please get in touch.");
    }

    for (const seat of seats) {
      const game = await ctx.db.get("games", seat.gameId);
      if (game === null) continue;

      const others = (await seatedAt(ctx, game._id)).filter(
        (p) => p.userId !== me._id,
      );
      if (others.every((p) => p.bot !== undefined)) {
        await deleteWholeGame(ctx, game._id);
        continue;
      }

      for await (const hint of ctx.db
        .query("hints")
        .withIndex("by_game_user_turn", (q) =>
          q.eq("gameId", game._id).eq("userId", me._id),
        )) {
        await ctx.db.delete("hints", hint._id);
      }
      if (game.status !== "finished") await leaveGame(ctx, game, seat, me._id);
    }

    for await (const edge of ctx.db
      .query("friendships")
      .withIndex("by_requester", (q) => q.eq("requesterId", me._id))) {
      await ctx.db.delete("friendships", edge._id);
    }
    for await (const edge of ctx.db
      .query("friendships")
      .withIndex("by_addressee", (q) => q.eq("addresseeId", me._id))) {
      await ctx.db.delete("friendships", edge._id);
    }
    for await (const invite of ctx.db
      .query("friendInvites")
      .withIndex("by_requester", (q) => q.eq("requesterId", me._id))) {
      await ctx.db.delete("friendInvites", invite._id);
    }
    for await (const link of ctx.db
      .query("friendLinks")
      .withIndex("by_user", (q) => q.eq("userId", me._id))) {
      await ctx.db.delete("friendLinks", link._id);
    }

    await ctx.db.replace("users", me._id, {
      authId: `deleted|${me._id}`,
      deletedAt: Date.now(),
    });

    await deleteAuthUser(ctx, me.authId);
    return null;
  },
});

/** More seats than any real player will have; past it, one transaction is too big. */
const MAX_GAMES = 2000;

/** Better Auth's user, with the sessions and linked Google account under it. */
async function deleteAuthUser(ctx: MutationCtx, authId: string) {
  for (const model of ["session", "account"] as const) {
    let cursor: string | null = null;
    for (;;) {
      const page: { isDone: boolean; continueCursor: string } =
        await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
          input: { model, where: [{ field: "userId", value: authId }] },
          paginationOpts: { numItems: 100, cursor },
        });
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
  }
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
    input: { model: "user", where: [{ field: "_id", value: authId }] },
  });
}
