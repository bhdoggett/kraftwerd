import { RULES_VERSION } from "../shared/config.js";
import { mutation, query } from "./_generated/server";
import { googleConfigured } from "./auth";
import { currentUser } from "./auth_helpers";

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
          name: user.name ?? user.email ?? null,
          image: user.image ?? null,
          /** An account made to try the game, with no way back into it. */
          isGuest: user.isGuest === true,
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
