import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { FRIEND_LINK_DAYS } from "../shared/config.js";
import { currentUser, displayName, refuseGuest } from "./auth_helpers";
import { seatOf } from "./seats";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

/** Most friendships anyone will have; keeps every query bounded. */
const MAX_FRIENDS = 200;

/**
 * Seats to read at one game. Four rather than `GAME.maxPlayers` so that a
 * table dealt before the cap came down to three still reads whole -- this is
 * a bound on a query, not a rule about how many may play.
 */
const MAX_SEATS = 4;

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

/**
 * The friendship rows between two people, one per direction a request could
 * have been sent in. Either, both or neither may exist.
 */
export async function rowsBetween(
  ctx: QueryCtx,
  a: Id<"users">,
  b: Id<"users">,
) {
  const [mine, theirs] = await Promise.all([
    ctx.db
      .query("friendships")
      .withIndex("by_pair", (q) => q.eq("requesterId", a).eq("addresseeId", b))
      .unique(),
    ctx.db
      .query("friendships")
      .withIndex("by_pair", (q) => q.eq("requesterId", b).eq("addresseeId", a))
      .unique(),
  ]);
  return { mine, theirs };
}

/**
 * Ask `to` to be friends with `from`, unless these two already have an answer
 * or a question between them.
 *
 * Idempotent and, deliberately, never decisive: a row already there is left
 * exactly as it is. A pending request stays pending -- asking again is not
 * answering, whichever direction it was sent in -- and an accepted friendship
 * is not asked for twice.
 */
export async function askToBeFriends(
  ctx: MutationCtx,
  from: Id<"users">,
  to: Id<"users">,
) {
  if (from === to) return;

  const { mine, theirs } = await rowsBetween(ctx, from, to);
  if (mine !== null || theirs !== null) return;

  await ctx.db.insert("friendships", {
    requesterId: from,
    addresseeId: to,
    status: "pending",
  });
}

export const listFriends = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentUser(ctx);
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
    const me = await currentUser(ctx);
    // A guest has no game to play with a friend, so no friends to make.
    refuseGuest(me);
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
    const { mine, theirs } = await rowsBetween(ctx, me._id, them._id);

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

/**
 * Where each human at a game stands with you: whether you are friends, which
 * of you asked, or neither.
 *
 * Its own query rather than a field on `getGame`, deliberately. That one is
 * the hottest read in the app -- every player, every turn, live -- and putting
 * friendships in its read set meant accepting a request re-pushed every open
 * board (see the note in `getGame`). This is read where it is needed: the
 * panel that offers the invite, which most turns never open.
 *
 * Empty at a public game, where the aliases exist because these people have
 * not met, so nothing there may be asked. Machines and your own seat are left
 * out: neither is somebody to befriend.
 */
export const statesAt = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const me = await currentUser(ctx);

    const game = await ctx.db.get("games", args.gameId);
    if (game === null || game.isPublic === true) return [];

    const seated = await ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .take(MAX_SEATS);
    if (!seated.some((p) => p.userId === me._id)) return [];

    const others = seated.filter(
      (p) => p.userId !== me._id && p.bot === undefined,
    );

    return await Promise.all(
      others.map(async (p) => {
        const { mine, theirs } = await rowsBetween(ctx, me._id, p.userId);
        const edge = mine ?? theirs;
        const state =
          edge === null
            ? ("none" as const)
            : edge.status === "accepted"
              ? ("friends" as const)
              : edge.requesterId === me._id
                ? ("asked" as const)
                : ("asking" as const);
        return { userId: p.userId, state };
      }),
    );
  },
});

/**
 * Ask somebody at the same game to be friends.
 *
 * The one way two people who met at a table can find each other afterwards:
 * an invitation asks whoever follows it, and the people it gathers are left
 * strangers to one another. Before this they had to swap email addresses,
 * which is an odd thing to need after playing a game together.
 */
export const inviteFromGame = mutation({
  args: { gameId: v.id("games"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const me = await currentUser(ctx);

    const game = await ctx.db.get("games", args.gameId);
    if (game === null) throw new ConvexError("No such game");

    /*
     * Never at a public game. Everyone there wears an alias precisely because
     * they have not met, and a request carries a real name to whoever answers
     * it -- which would make the one screen that promises anonymity the one
     * that spends it.
     */
    if (game.isPublic === true) {
      throw new ConvexError("Not at a game with strangers");
    }

    // Both of you at the same table, or there is no acquaintance to trade on:
    // the game is the whole of what these two have in common.
    const mine = await seatOf(ctx, args.gameId, me._id);
    if (mine === null) throw new ConvexError("You are not in this game");

    const theirs = await seatOf(ctx, args.gameId, args.userId);
    if (theirs === null) throw new ConvexError("They are not in this game");
    if (theirs.bot !== undefined) {
      throw new ConvexError("That is a computer player");
    }

    await askToBeFriends(ctx, me._id, args.userId);
    return null;
  },
});

export const respondToRequest = mutation({
  args: { friendshipId: v.id("friendships"), accept: v.boolean() },
  handler: async (ctx, args) => {
    const me = await currentUser(ctx);

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
    const me = await currentUser(ctx);

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
    const me = await currentUser(ctx);

    const invite = await ctx.db.get("friendInvites", args.inviteId);
    if (invite === null) return null;
    if (invite.requesterId !== me._id) throw new ConvexError("That invite is not yours");

    await ctx.db.delete("friendInvites", args.inviteId);
    return null;
  },
});

/**
 * A token for a URL: long enough that guessing one is hopeless, and made of
 * characters that survive being pasted into a chat window.
 */
function newToken(): string {
  let token = "";
  while (token.length < 24) token += Math.random().toString(36).slice(2);
  return token.slice(0, 24);
}

const linkLife = () => Date.now() + FRIEND_LINK_DAYS * 24 * 60 * 60 * 1000;

/** A row from before links ran out has no date, which counts as run out. */
const spent = (link: Doc<"friendLinks">) => (link.expiresAt ?? 0) <= Date.now();

async function linkFor(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("friendLinks")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

export const myFriendLink = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentUser(ctx);
    const link = await linkFor(ctx, me._id);

    // A link past its date is no link: offering it would be offering something
    // that does not work.
    if (link === null || spent(link)) return null;
    return { token: link.token, expiresAt: link.expiresAt };
  },
});

/**
 * The link, made on first use.
 *
 * Asking again gives the same one back with its clock wound forward, so the
 * link you are sending right now lasts the full window rather than however
 * much was left of the last one.
 */
export const createFriendLink = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await currentUser(ctx);
    // A guest has no game to play with a friend, so no friends to make.
    refuseGuest(me);
    const expiresAt = linkLife();

    const existing = await linkFor(ctx, me._id);
    if (existing !== null) {
      // Past its date it is public knowledge, so it gets a new secret rather
      // than a new lease.
      const token = spent(existing) ? newToken() : existing.token;
      await ctx.db.patch("friendLinks", existing._id, { token, expiresAt });
      return token;
    }

    const token = newToken();
    await ctx.db.insert("friendLinks", { userId: me._id, token, expiresAt });
    return token;
  },
});

/**
 * Become friends by following someone's link.
 *
 * Accepted outright rather than left pending: sharing the link is the consent,
 * the same way joining a game from its link is.
 */
export const acceptFriendLink = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const me = await currentUser(ctx);
    // A guest has no game to play with a friend, so no friends to make.
    refuseGuest(me);

    const link = await ctx.db
      .query("friendLinks")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    // A link that has run out, or was never one, is an ordinary thing to
    // arrive holding — so it is an answer rather than a failure, and the page
    // on the other end can say something useful about it.
    if (link === null) return { ok: false, reason: "unknown" } as const;
    if (spent(link)) return { ok: false, reason: "expired" } as const;

    const them = await ctx.db.get("users", link.userId);
    if (them === null) return { ok: false, reason: "unknown" } as const;
    if (them._id === me._id) return { ok: false, reason: "own" } as const;

    // A pair can already be linked from either direction, and either row may
    // still be pending — following a link settles it.
    const { mine, theirs } = await rowsBetween(ctx, me._id, them._id);

    const edge = mine ?? theirs;
    if (edge !== null) {
      if (edge.status !== "accepted") {
        await ctx.db.patch("friendships", edge._id, { status: "accepted" });
      }
    } else {
      await ctx.db.insert("friendships", {
        requesterId: them._id,
        addresseeId: me._id,
        status: "accepted",
      });
    }

    return { ok: true, name: displayName(them) } as const;
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
