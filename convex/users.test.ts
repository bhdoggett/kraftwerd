/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { RULES_VERSION } from "../shared/config";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("rules seen", () => {
  test("a row from before tracking reads as having seen version 9", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { authId: "auth|a", displayName: "Ana" }));
    const asAna = t.withIdentity({ subject: "auth|a" });

    expect((await asAna.query(api.users.viewer))?.rulesSeen).toBe(9);
  });

  test("acknowledging brings it up to the current version", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { authId: "auth|a", displayName: "Ana", rulesSeen: 9 }));
    const asAna = t.withIdentity({ subject: "auth|a" });

    await asAna.mutation(api.users.acknowledgeRules, {});

    expect((await asAna.query(api.users.viewer))?.rulesSeen).toBe(RULES_VERSION);
  });
});

describe("display names", () => {
  /** Two people as Google hands them over: a real name and an address, nothing chosen. */
  async function fromGoogle() {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        authId: "auth|a",
        name: "Ana Real-Surname",
        email: "ana.realsurname@gmail.com",
      });
      await ctx.db.insert("users", {
        authId: "auth|b",
        name: "Bo Real-Surname",
        email: "bo.realsurname@gmail.com",
      });
    });
    return {
      t,
      asAna: t.withIdentity({ subject: "auth|a" }),
      asBo: t.withIdentity({ subject: "auth|b" }),
    };
  }

  test("a new account is asked for one", async () => {
    const { asAna } = await fromGoogle();
    const me = await asAna.query(api.users.viewer);
    expect(me?.needsDisplayName).toBe(true);
    expect(me?.displayName).toBeNull();
  });

  test("a guest is not asked", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { authId: "auth|g", isGuest: true }));
    const me = await t.withIdentity({ subject: "auth|g" }).query(api.users.viewer);
    expect(me?.needsDisplayName).toBe(false);
  });

  test("choosing one stores it tidied and stops the asking", async () => {
    const { asAna } = await fromGoogle();
    await asAna.mutation(api.users.setDisplayName, { name: "  Word   Nerd " });
    const me = await asAna.query(api.users.viewer);
    expect(me?.displayName).toBe("Word Nerd");
    expect(me?.needsDisplayName).toBe(false);
  });

  test("an email address is refused", async () => {
    const { asAna } = await fromGoogle();
    await expect(
      asAna.mutation(api.users.setDisplayName, { name: "ana@gmail.com" }),
    ).rejects.toThrow(/email/i);
  });

  test("other players in a private game see neither the Google name nor the address", async () => {
    const { asAna, asBo } = await fromGoogle();
    const { gameId } = await asAna.mutation(api.games.createGame, { playerCount: 2 });
    await asBo.mutation(api.games.joinGame, { gameId });

    const seen = JSON.stringify(await asBo.query(api.games.getGame, { gameId }));
    expect(seen).not.toMatch(/Real-Surname|realsurname/i);

    await asAna.mutation(api.users.setDisplayName, { name: "Word Nerd" });
    const view = await asBo.query(api.games.getGame, { gameId });
    expect(view?.players.map((p) => p.name)).toContain("Word Nerd");
  });

  test("a friend sees the chosen name and no address", async () => {
    const { asAna, asBo } = await fromGoogle();
    await asAna.mutation(api.users.setDisplayName, { name: "Word Nerd" });
    await asAna.mutation(api.friends.requestFriend, { email: "bo.realsurname@gmail.com" });
    const { incoming } = await asBo.query(api.friends.listFriends);
    await asBo.mutation(api.friends.respondToRequest, {
      friendshipId: incoming[0].friendshipId,
      accept: true,
    });

    const seen = await asBo.query(api.friends.listFriends);
    expect(seen.friends.map((f) => f.name)).toEqual(["Word Nerd"]);
    expect(JSON.stringify(seen)).not.toMatch(/Real-Surname|realsurname/i);
  });
});

describe("the suggested name", () => {
  test("is the Google first name, and is not shown until kept", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { authId: "auth|a", name: "Ana Real-Surname" }));
    const asAna = t.withIdentity({ subject: "auth|a" });

    const me = await asAna.query(api.users.viewer);
    expect(me?.suggestedDisplayName).toBe("Ana");
    expect(me?.displayName).toBeNull();
  });
});
