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
      // Sent to an address nobody has signed in with yet.
      invited: (
        await ctx.db
          .query("friendInvites")
          .withIndex("by_requester", (q) => q.eq("requesterId", me._id))
          .take(MAX_FRIENDS)
      ).map((invite) => ({ inviteId: invite._id, email: invite.email })),
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

    // Nobody with that address yet: hold the request until somebody signs in
    // with it. Otherwise you could only befriend people already playing, which
    // is the wrong way round for inviting anyone.
    if (them === null) {
      const held = await ctx.db
        .query("friendInvites")
        .withIndex("by_pair", (q) => q.eq("requesterId", me._id).eq("email", email))
        .unique();
      if (held === null) {
        await ctx.db.insert("friendInvites", { requesterId: me._id, email });
      }
      return null;
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

/** Withdraw an invitation sent to an address nobody has claimed yet. */
export const cancelInvite = mutation({
  args: { inviteId: v.id("friendInvites") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);

    const invite = await ctx.db.get("friendInvites", args.inviteId);
    if (invite === null) return null;
    if (invite.requesterId !== me._id) throw new ConvexError("That invite is not yours");

    await ctx.db.delete("friendInvites", args.inviteId);
    return null;
  },
});

/**
 * Turn any invitations addressed to this user into pending friendships.
 *
 * Called when a user record is created, so somebody who was invited before
 * they had an account finds the request waiting rather than lost.
 */
export async function claimInvites(
  ctx: MutationCtx,
  userId: Id<"users">,
  email: string | undefined,
) {
  if (email === undefined) return;

  const invites = await ctx.db
    .query("friendInvites")
    .withIndex("by_email", (q) => q.eq("email", email.toLowerCase()))
    .take(MAX_FRIENDS);

  for (const invite of invites) {
    if (invite.requesterId !== userId) {
      await ctx.db.insert("friendships", {
        requesterId: invite.requesterId,
        addresseeId: userId,
        status: "pending",
      });
    }
    await ctx.db.delete("friendInvites", invite._id);
  }
}
