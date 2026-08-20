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
