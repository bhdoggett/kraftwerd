import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

/** Most friendships anyone will have; keeps every query bounded. */
const MAX_FRIENDS = 200;

async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new ConvexError("Not signed in");

  const user = await ctx.db
    .query("users")
    .withIndex("by_authId", (q) => q.eq("authId", identity.subject))
    .unique();
  if (user === null) throw new ConvexError("No user record for this identity");

  return user;
}

function displayName(user: Doc<"users"> | null): string {
  if (user === null) return "Unknown";
  if (user.name && user.name.trim() !== "") return user.name;
  if (user.email) return user.email.split("@")[0]!;
  return "Player";
}

/** Every friendship row mentioning this user, in either direction. */
async function edgesFor(ctx: QueryCtx, userId: Id<"users">) {
  const [sent, received] = await Promise.all([
    ctx.db
      .query("friendships")
      .withIndex("by_requester", (q) => q.eq("requesterId", userId))
      .take(MAX_FRIENDS),
    ctx.db
      .query("friendships")
      .withIndex("by_addressee", (q) => q.eq("addresseeId", userId))
      .take(MAX_FRIENDS),
  ]);
  return { sent, received };
}

export const listFriends = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const { sent, received } = await edgesFor(ctx, me._id);

    const hydrate = async (edge: Doc<"friendships">, otherId: Id<"users">) => {
      const user = await ctx.db.get("users", otherId);
      return {
        friendshipId: edge._id,
        userId: otherId,
        name: displayName(user),
        email: user?.email ?? null,
      };
    };

    return {
      friends: await Promise.all([
        ...sent
          .filter((e) => e.status === "accepted")
          .map((e) => hydrate(e, e.addresseeId)),
        ...received
          .filter((e) => e.status === "accepted")
          .map((e) => hydrate(e, e.requesterId)),
      ]),
      // Requests waiting on you to accept.
      incoming: await Promise.all(
        received.filter((e) => e.status === "pending").map((e) => hydrate(e, e.requesterId)),
      ),
      // Requests you sent that have not been accepted yet.
      outgoing: await Promise.all(
        sent.filter((e) => e.status === "pending").map((e) => hydrate(e, e.addresseeId)),
      ),
    };
  },
});

export const requestFriend = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const email = args.email.trim().toLowerCase();

    if (email === "") throw new ConvexError("Enter an email address");
    if (email === me.email?.toLowerCase()) throw new ConvexError("That is your own address");

    const them = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    // Deliberately explicit rather than a vague "request sent": there is no
    // invitation email, so a silent no-op would look like a bug.
    if (them === null) {
      throw new ConvexError("Nobody with that address has signed in to Word Craft yet");
    }

    // A pair can already be linked from either direction.
    const [mine, theirs] = await Promise.all([
      ctx.db
        .query("friendships")
        .withIndex("by_pair", (q) =>
          q.eq("requesterId", me._id).eq("addresseeId", them._id),
        )
        .unique(),
      ctx.db
        .query("friendships")
        .withIndex("by_pair", (q) =>
          q.eq("requesterId", them._id).eq("addresseeId", me._id),
        )
        .unique(),
    ]);

    if (mine !== null) throw new ConvexError("You have already asked them");

    // They asked you first: treat this as accepting rather than creating a
    // second row pointing the other way.
    if (theirs !== null) {
      if (theirs.status === "pending") {
        await ctx.db.patch("friendships", theirs._id, { status: "accepted" });
      }
      return null;
    }

    await ctx.db.insert("friendships", {
      requesterId: me._id,
      addresseeId: them._id,
      status: "pending",
    });
    return null;
  },
});

export const respondToRequest = mutation({
  args: { friendshipId: v.id("friendships"), accept: v.boolean() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);

    const edge = await ctx.db.get("friendships", args.friendshipId);
    if (edge === null) throw new ConvexError("No such request");
    // Only the addressee may answer, or anyone could accept on your behalf.
    if (edge.addresseeId !== me._id) throw new ConvexError("That request is not yours");

    if (args.accept) {
      await ctx.db.patch("friendships", args.friendshipId, { status: "accepted" });
    } else {
      await ctx.db.delete("friendships", args.friendshipId);
    }
    return null;
  },
});

export const removeFriend = mutation({
  args: { friendshipId: v.id("friendships") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);

    const edge = await ctx.db.get("friendships", args.friendshipId);
    if (edge === null) return null;
    if (edge.requesterId !== me._id && edge.addresseeId !== me._id) {
      throw new ConvexError("That friendship is not yours");
    }

    await ctx.db.delete("friendships", args.friendshipId);
    return null;
  },
});
