import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * The signed-in player's app user row.
 *
 * Better Auth puts its user id in the JWT subject, so identity resolves with
 * one indexed read instead of a round-trip into the auth component. Convex has
 * already verified the token's signature and expiry; the component's extra
 * session check would only add revoke-before-expiry precision, which this game
 * does not need.
 */
export async function currentUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new ConvexError("Not signed in");

  const user = await ctx.db
    .query("users")
    .withIndex("by_authId", (q) => q.eq("authId", identity.subject))
    .unique();
  if (user === null) throw new ConvexError("No user record for this identity");

  return user;
}

export async function requireUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  return (await currentUser(ctx))._id;
}

/**
 * A guest may play the game, but not other people.
 *
 * A guest account has no way back into it: no email, no password, no Google
 * -- only a cookie in one browser. That is fine for a game against the
 * computer and unfair to everybody else, since the other player at the table
 * would be left in a game whose opponent can never move again, with nothing
 * they can do about it. Refused at the mutation rather than only hidden in
 * the interface: it is the mutation that would strand the game.
 */
export function refuseGuest(user: Doc<"users">): void {
  if (user.isGuest === true) {
    throw new ConvexError("Make an account to play with other people");
  }
}

/** Prefer a real name, fall back to the local part of the email. */
export function displayName(user: Doc<"users"> | null): string {
  if (user === null) return "Unknown";
  if (user.name && user.name.trim() !== "") return user.name;
  if (user.email) return user.email.split("@")[0]!;
  return "Player";
}
