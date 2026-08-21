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
      friendshipId: pending.incoming[0]!.friendshipId,
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
      friendshipId: pending.incoming[0]!.friendshipId,
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
        friendshipId: pending.incoming[0]!.friendshipId,
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

    const held = (await asAna.query(api.friends.listFriends)).invited[0]!;
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
