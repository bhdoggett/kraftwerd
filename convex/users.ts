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

    return user === null
      ? null
      : {
          id: user._id,
          name: user.name ?? user.email ?? null,
          image: user.image ?? null,
          stats: {
            wins: user.wins ?? 0,
            gamesPlayed: user.gamesPlayed ?? 0,
            bestGameScore: user.bestGameScore ?? 0,
            bestTurnScore: user.bestTurnScore ?? 0,
          },
        };
  },
});

/** Lets the sign-in screen explain itself when Google is not set up yet. */
export const authStatus = query({
  args: {},
  handler: async () => ({ googleConfigured }),
});
