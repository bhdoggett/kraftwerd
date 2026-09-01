import { RULES_VERSION } from "../shared/config.js";
import { query } from "./_generated/server";
import { googleConfigured } from "./auth";

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
