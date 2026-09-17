/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Excludes test files: globbing them made each test module import the
// others, which reads as a dependency cycle and loads them needlessly.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function twoUsers() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "auth|a", name: "Ana", email: "ana@example.com" });
    await ctx.db.insert("users", { authId: "auth|b", name: "Bo", email: "bo@example.com" });
  });
  return { t, asAna: t.withIdentity({ subject: "auth|a" }), asBo: t.withIdentity({ subject: "auth|b" }) };
}

describe("friends", () => {
  test("a request shows as outgoing for the sender and incoming for the recipient", async () => {
    const { asAna, asBo } = await twoUsers();

    await asAna.mutation(api.friends.requestFriend, { email: "bo@example.com" });

    const ana = await asAna.query(api.friends.listFriends);
    const bo = await asBo.query(api.friends.listFriends);

    expect(ana.outgoing).toHaveLength(1);
    expect(ana.friends).toHaveLength(0);
    expect(bo.incoming).toHaveLength(1);
    expect(bo.incoming[0]?.name).toBe("Ana");
  });

  test("accepting makes them friends for both sides", async () => {
    const { asAna, asBo } = await twoUsers();
    await asAna.mutation(api.friends.requestFriend, { email: "bo@example.com" });

    const pending = await asBo.query(api.friends.listFriends);
    await asBo.mutation(api.friends.respondToRequest, {
      friendshipId: pending.incoming[0].friendshipId,
      accept: true,
    });

    expect((await asAna.query(api.friends.listFriends)).friends).toHaveLength(1);
    expect((await asBo.query(api.friends.listFriends)).friends).toHaveLength(1);
  });

  test("declining removes the request entirely", async () => {
    const { asAna, asBo } = await twoUsers();
    await asAna.mutation(api.friends.requestFriend, { email: "bo@example.com" });

    const pending = await asBo.query(api.friends.listFriends);
    await asBo.mutation(api.friends.respondToRequest, {
      friendshipId: pending.incoming[0].friendshipId,
      accept: false,
    });

    expect((await asBo.query(api.friends.listFriends)).incoming).toHaveLength(0);
    expect((await asAna.query(api.friends.listFriends)).outgoing).toHaveLength(0);
  });

  test("only the addressee may answer a request", async () => {
    const { asAna, asBo } = await twoUsers();
    await asAna.mutation(api.friends.requestFriend, { email: "bo@example.com" });
    const pending = await asBo.query(api.friends.listFriends);

    await expect(
      asAna.mutation(api.friends.respondToRequest, {
        friendshipId: pending.incoming[0].friendshipId,
        accept: true,
      }),
    ).rejects.toThrow("not yours");
  });

  test("asking someone who already asked you accepts instead of duplicating", async () => {
    const { asAna, asBo } = await twoUsers();
    await asAna.mutation(api.friends.requestFriend, { email: "bo@example.com" });
    await asBo.mutation(api.friends.requestFriend, { email: "ana@example.com" });

    const bo = await asBo.query(api.friends.listFriends);
    expect(bo.friends).toHaveLength(1);
    expect(bo.incoming).toHaveLength(0);
    expect(bo.outgoing).toHaveLength(0);
  });

  test("a request to an address nobody has used is held, not refused", async () => {
    const { asAna } = await twoUsers();

    await asAna.mutation(api.friends.requestFriend, { email: "nobody@example.com" });

    const list = await asAna.query(api.friends.listFriends);
    expect(list.invited).toEqual([
      expect.objectContaining({ email: "nobody@example.com" }),
    ]);
    expect(list.outgoing).toHaveLength(0);
  });

  test("holding the same address twice does not stack up invites", async () => {
    const { asAna } = await twoUsers();

    await asAna.mutation(api.friends.requestFriend, { email: "nobody@example.com" });
    await asAna.mutation(api.friends.requestFriend, { email: "NOBODY@example.com" });

    expect((await asAna.query(api.friends.listFriends)).invited).toHaveLength(1);
  });

  test("a held invite can be withdrawn", async () => {
    const { asAna } = await twoUsers();
    await asAna.mutation(api.friends.requestFriend, { email: "nobody@example.com" });

    const held = (await asAna.query(api.friends.listFriends)).invited[0];
    await asAna.mutation(api.friends.cancelInvite, { inviteId: held.inviteId });

    expect((await asAna.query(api.friends.listFriends)).invited).toHaveLength(0);
  });

  test("you cannot befriend yourself", async () => {
    const { asAna } = await twoUsers();

    await expect(
      asAna.mutation(api.friends.requestFriend, { email: "ana@example.com" }),
    ).rejects.toThrow("your own address");
  });
});

describe("invite links", () => {
  test("following someone's link makes you friends straight away", async () => {
    const { asAna, asBo } = await twoUsers();

    const token = await asAna.mutation(api.friends.createFriendLink, {});
    const result = await asBo.mutation(api.friends.acceptFriendLink, { token });

    expect(result).toEqual({ ok: true, name: "Ana" });
    expect((await asBo.query(api.friends.listFriends)).friends).toHaveLength(1);
    expect((await asAna.query(api.friends.listFriends)).friends).toHaveLength(1);
  });

  test("the link is the same one every time it is asked for", async () => {
    const { asAna } = await twoUsers();

    const first = await asAna.mutation(api.friends.createFriendLink, {});
    const again = await asAna.mutation(api.friends.createFriendLink, {});

    expect(again).toBe(first);
    expect((await asAna.query(api.friends.myFriendLink))?.token).toBe(first);
  });

  test("asking for the link again gives it a full life", async () => {
    const { t, asAna } = await twoUsers();
    const token = await asAna.mutation(api.friends.createFriendLink, {});

    // As though it were made six days ago and nearly out of time.
    const soon = Date.now() + 60_000;
    await t.run(async (ctx) => {
      const link = await ctx.db
        .query("friendLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique();
      await ctx.db.patch("friendLinks", link!._id, { expiresAt: soon });
    });

    await asAna.mutation(api.friends.createFriendLink, {});

    const link = await t.run(async (ctx) =>
      ctx.db
        .query("friendLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique(),
    );
    expect(link?.expiresAt).toBeGreaterThan(soon);
  });

  test("following the same link twice leaves one friendship", async () => {
    const { asAna, asBo } = await twoUsers();
    const token = await asAna.mutation(api.friends.createFriendLink, {});

    await asBo.mutation(api.friends.acceptFriendLink, { token });
    await asBo.mutation(api.friends.acceptFriendLink, { token });

    expect((await asBo.query(api.friends.listFriends)).friends).toHaveLength(1);
  });

  test("a link accepts a request they had already sent you", async () => {
    const { asAna, asBo } = await twoUsers();
    await asBo.mutation(api.friends.requestFriend, { email: "ana@example.com" });

    const token = await asAna.mutation(api.friends.createFriendLink, {});
    await asBo.mutation(api.friends.acceptFriendLink, { token });

    const bo = await asBo.query(api.friends.listFriends);
    expect(bo.outgoing).toHaveLength(0);
    expect(bo.friends).toHaveLength(1);
  });

  test("a link that has run out is turned away, and says so", async () => {
    const { t, asAna, asBo } = await twoUsers();
    const token = await asAna.mutation(api.friends.createFriendLink, {});

    await t.run(async (ctx) => {
      const link = await ctx.db
        .query("friendLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique();
      await ctx.db.patch("friendLinks", link!._id, { expiresAt: Date.now() - 1 });
    });

    expect(await asBo.mutation(api.friends.acceptFriendLink, { token })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect((await asBo.query(api.friends.listFriends)).friends).toHaveLength(0);
  });

  test("a stale link is replaced rather than reused", async () => {
    const { t, asAna } = await twoUsers();
    const old = await asAna.mutation(api.friends.createFriendLink, {});
    await t.run(async (ctx) => {
      const link = await ctx.db
        .query("friendLinks")
        .withIndex("by_token", (q) => q.eq("token", old))
        .unique();
      await ctx.db.patch("friendLinks", link!._id, { expiresAt: Date.now() - 1 });
    });

    const fresh = await asAna.mutation(api.friends.createFriendLink, {});

    expect(fresh).not.toBe(old);
    expect((await asAna.query(api.friends.myFriendLink))?.token).toBe(fresh);
  });

  test("a link from before links ran out is treated as run out", async () => {
    const { t, asAna, asBo } = await twoUsers();
    const token = await asAna.mutation(api.friends.createFriendLink, {});
    // A row written before the field existed, as production still holds.
    await t.run(async (ctx) => {
      const link = await ctx.db
        .query("friendLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique();
      await ctx.db.patch("friendLinks", link!._id, { expiresAt: undefined });
    });

    expect(await asBo.mutation(api.friends.acceptFriendLink, { token })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(await asAna.query(api.friends.myFriendLink)).toBeNull();

    // Sending a new one puts the row right, with a new secret.
    const fresh = await asAna.mutation(api.friends.createFriendLink, {});
    expect(fresh).not.toBe(token);
    expect((await asBo.mutation(api.friends.acceptFriendLink, { token: fresh })).ok).toBe(
      true,
    );
  });

  test("your own link does not befriend you to yourself", async () => {
    const { asAna } = await twoUsers();
    const token = await asAna.mutation(api.friends.createFriendLink, {});

    expect(await asAna.mutation(api.friends.acceptFriendLink, { token })).toEqual({
      ok: false,
      reason: "own",
    });
    expect((await asAna.query(api.friends.listFriends)).friends).toHaveLength(0);
  });

  test("an unknown token is turned away", async () => {
    const { asBo } = await twoUsers();

    expect(
      await asBo.mutation(api.friends.acceptFriendLink, { token: "nonsense" }),
    ).toEqual({ ok: false, reason: "unknown" });
  });
});

/**
 * Two people invited by the same host are strangers to each other: the host's
 * link asked each of them, and asking on their behalf is not the host's to do.
 * Before this they could only meet by one of them knowing the other's email
 * address, which is a strange thing to need after a game together.
 */
describe("asking from inside a game", () => {
  async function tableOfThree() {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "auth|host", name: "Host" });
      await ctx.db.insert("users", { authId: "auth|guest", name: "Guest" });
      await ctx.db.insert("users", { authId: "auth|third", name: "Third" });
    });

    const asHost = t.withIdentity({ subject: "auth|host" });
    const asGuest = t.withIdentity({ subject: "auth|guest" });
    const asThird = t.withIdentity({ subject: "auth|third" });

    const { gameId } = await asHost.mutation(api.games.createGame, { playerCount: 3 });
    await asGuest.mutation(api.games.joinGame, { gameId });
    await asThird.mutation(api.games.joinGame, { gameId });

    const third = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("users")
        .withIndex("by_authId", (q) => q.eq("authId", "auth|third"))
        .unique();
      return row!._id;
    });

    return { t, gameId, asHost, asGuest, asThird, third };
  }

  test("asking someone at your table sends a request, not a friendship", async () => {
    const { gameId, asGuest, asThird, third } = await tableOfThree();

    await asGuest.mutation(api.friends.inviteFromGame, { gameId, userId: third });

    const guest = await asGuest.query(api.friends.listFriends);
    const theirs = await asThird.query(api.friends.listFriends);

    expect(guest.friends).toHaveLength(0);
    expect(guest.outgoing.map((o) => o.name)).toEqual(["Third"]);
    // Alongside the host's own request, which joining the game sent.
    expect(theirs.incoming.map((i) => i.name)).toContain("Guest");
  });

  test("the table says who has been asked, and by whom", async () => {
    const { t, gameId, asGuest, asThird, third } = await tableOfThree();
    const guest = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("users")
        .withIndex("by_authId", (q) => q.eq("authId", "auth|guest"))
        .unique();
      return row!._id;
    });

    // Nothing between the two guests: the host asked each of them, not them
    // each other.
    const before = await asGuest.query(api.friends.statesAt, { gameId });
    expect(before.find((s) => s.userId === third)?.state).toBe("none");

    await asGuest.mutation(api.friends.inviteFromGame, { gameId, userId: third });

    const after = await asGuest.query(api.friends.statesAt, { gameId });
    expect(after.find((s) => s.userId === third)?.state).toBe("asked");

    const theirs = await asThird.query(api.friends.statesAt, { gameId });
    expect(theirs.find((s) => s.userId === guest)?.state).toBe("asking");
  });

  test("asking twice leaves the one request", async () => {
    const { gameId, asGuest, third } = await tableOfThree();

    await asGuest.mutation(api.friends.inviteFromGame, { gameId, userId: third });
    await asGuest.mutation(api.friends.inviteFromGame, { gameId, userId: third });

    expect((await asGuest.query(api.friends.listFriends)).outgoing).toHaveLength(1);
  });

  test("asking somebody who already asked you leaves theirs to answer", async () => {
    const { gameId, asGuest, asThird, third, t } = await tableOfThree();
    const guest = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("users")
        .withIndex("by_authId", (q) => q.eq("authId", "auth|guest"))
        .unique();
      return row!._id;
    });

    await asThird.mutation(api.friends.inviteFromGame, { gameId, userId: guest });
    await asGuest.mutation(api.friends.inviteFromGame, { gameId, userId: third });

    // Pressing a button is not answering a question: theirs is still waiting
    // in the friends list, where answering it belongs.
    const mine = await asGuest.query(api.friends.listFriends);
    expect(mine.friends).toHaveLength(0);
    expect(mine.outgoing).toHaveLength(0);
    expect(mine.incoming.map((i) => i.name)).toContain("Third");
  });

  test("nobody is asked from a game with strangers", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "auth|host", name: "Host" });
      await ctx.db.insert("users", { authId: "auth|guest", name: "Guest" });
      await ctx.db.insert("users", { authId: "auth|third", name: "Third" });
    });
    const asHost = t.withIdentity({ subject: "auth|host" });
    const asGuest = t.withIdentity({ subject: "auth|guest" });
    const asThird = t.withIdentity({ subject: "auth|third" });
    const { gameId } = await asHost.mutation(api.games.createGame, {
      playerCount: 3,
      isPublic: true,
    });
    await asGuest.mutation(api.games.joinGame, { gameId });
    await asThird.mutation(api.games.joinGame, { gameId });
    const third = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("users")
        .withIndex("by_authId", (q) => q.eq("authId", "auth|third"))
        .unique();
      return row!._id;
    });

    // The aliases exist because these people have not met. A request would
    // put a real name to one of them.
    await expect(
      asGuest.mutation(api.friends.inviteFromGame, { gameId, userId: third }),
    ).rejects.toThrow("strangers");
  });

  test("you cannot ask about a game you are not at", async () => {
    const { t, gameId, third } = await tableOfThree();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "auth|outsider", name: "Outsider" });
    });
    const asOutsider = t.withIdentity({ subject: "auth|outsider" });

    await expect(
      asOutsider.mutation(api.friends.inviteFromGame, { gameId, userId: third }),
    ).rejects.toThrow("not in this game");
  });

  test("you cannot ask somebody who is not at the table", async () => {
    const { t, gameId, asGuest } = await tableOfThree();
    const outsider = await t.run(async (ctx) =>
      ctx.db.insert("users", { authId: "auth|outsider", name: "Outsider" }),
    );

    await expect(
      asGuest.mutation(api.friends.inviteFromGame, { gameId, userId: outsider }),
    ).rejects.toThrow("not in this game");
  });

  test("a machine has nobody to be friends with", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "auth|solo", name: "Solo" });
    });
    const asSolo = t.withIdentity({ subject: "auth|solo" });
    const { gameId } = await asSolo.mutation(api.games.createGame, {
      playerCount: 2,
      bots: [{ level: "medium", name: "Gawain" }],
    });
    const machine = await t.run(async (ctx) => {
      const seats = await ctx.db
        .query("players")
        .withIndex("by_game", (q) => q.eq("gameId", gameId))
        .take(4);
      return seats.find((p) => p.bot !== undefined)!.userId;
    });

    await expect(
      asSolo.mutation(api.friends.inviteFromGame, { gameId, userId: machine }),
    ).rejects.toThrow("computer player");
  });
});
