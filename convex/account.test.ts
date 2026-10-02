/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, components } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/**
 * Two people, each with a Better Auth user, a session and a linked Google
 * account behind their app row -- the rows deleting an account has to reach.
 */
async function twoPeople() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);

  const person = async (name: string, email: string) => {
    const authUser = (await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: { name, email, emailVerified: true, createdAt: 0, updatedAt: 0 },
      },
    })) as { _id: string };
    const authId = authUser._id;
    await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: { userId: authId, token: `token-${name}`, expiresAt: 1e13, createdAt: 0, updatedAt: 0 },
      },
    });
    await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "account",
        data: { userId: authId, accountId: `google-${name}`, providerId: "google", createdAt: 0, updatedAt: 0 },
      },
    });
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { authId, name, email, displayName: name.split(" ")[0] }),
    );
    return { authId, userId, as: t.withIdentity({ subject: authId }) };
  };

  return {
    t,
    ana: await person("Ana Real-Surname", "ana@gmail.com"),
    bo: await person("Bo Real-Surname", "bo@gmail.com"),
  };
}

/** A game between the two that has had a turn played, so leaving it resigns. */
async function startedGame(
  t: Awaited<ReturnType<typeof twoPeople>>["t"],
  ana: Awaited<ReturnType<typeof twoPeople>>["ana"],
  bo: Awaited<ReturnType<typeof twoPeople>>["bo"],
) {
  const { gameId } = await ana.as.mutation(api.games.createGame, { playerCount: 2 });
  await bo.as.mutation(api.games.joinGame, { gameId });
  await t.run((ctx) => ctx.db.patch("games", gameId, { status: "active", turnNumber: 1 }));
  return gameId;
}

async function authRows(t: Awaited<ReturnType<typeof twoPeople>>["t"], authId: string) {
  const find = (model: "user" | "session" | "account", field: string) =>
    t.query(components.betterAuth.adapter.findOne, {
      model,
      where: [{ field, value: authId }],
    });
  return {
    user: await find("user", "_id"),
    session: await find("session", "userId"),
    account: await find("account", "userId"),
  };
}

describe("deleting an account", () => {
  test("resigns a game in progress, and the other player wins it", async () => {
    const { t, ana, bo } = await twoPeople();
    const gameId = await startedGame(t, ana, bo);

    await ana.as.mutation(api.users.deleteAccount, {});

    const game = await t.run((ctx) => ctx.db.get("games", gameId));
    expect(game?.status).toBe("finished");
    expect(game?.winnerIds).toEqual([bo.userId]);
  });

  test("shows them to the other player as a deleted player, with nothing that says who", async () => {
    const { t, ana, bo } = await twoPeople();
    const gameId = await startedGame(t, ana, bo);

    await ana.as.mutation(api.users.deleteAccount, {});

    const view = await bo.as.query(api.games.getGame, { gameId });
    expect(view?.players.map((p) => p.name)).toContain("Deleted player");
    const row = await t.run((ctx) => ctx.db.get("users", ana.userId));
    expect(JSON.stringify(row)).not.toMatch(/Ana|gmail/);
  });

  test("removes a game with nobody else in it entirely", async () => {
    const { t, ana } = await twoPeople();
    const { gameId } = await ana.as.mutation(api.games.createGame, {
      playerCount: 2,
      bots: [{ level: "medium", name: "Gawain" }],
    });

    await ana.as.mutation(api.users.deleteAccount, {});

    const left = await t.run(async (ctx) => ({
      game: await ctx.db.get("games", gameId),
      players: await ctx.db
        .query("players")
        .withIndex("by_game", (q) => q.eq("gameId", gameId))
        .collect(),
      tiles: await ctx.db
        .query("tiles")
        .withIndex("by_game", (q) => q.eq("gameId", gameId))
        .collect(),
    }));
    expect(left).toEqual({ game: null, players: [], tiles: [] });
  });

  test("cancels a game they made that nobody has played yet", async () => {
    const { t, ana, bo } = await twoPeople();
    const { gameId } = await ana.as.mutation(api.games.createGame, { playerCount: 2 });
    await bo.as.mutation(api.games.joinGame, { gameId });

    await ana.as.mutation(api.users.deleteAccount, {});

    expect(await t.run((ctx) => ctx.db.get("games", gameId))).toBeNull();
  });

  test("ends their friendships on both sides", async () => {
    const { ana, bo } = await twoPeople();
    await ana.as.mutation(api.friends.requestFriend, { email: "bo@gmail.com" });
    const { incoming } = await bo.as.query(api.friends.listFriends);
    await bo.as.mutation(api.friends.respondToRequest, {
      friendshipId: incoming[0].friendshipId,
      accept: true,
    });

    await ana.as.mutation(api.users.deleteAccount, {});

    const seen = await bo.as.query(api.friends.listFriends);
    expect(seen.friends).toEqual([]);
  });

  test("removes the Better Auth user, session and Google account, and no one else's", async () => {
    const { t, ana, bo } = await twoPeople();

    await ana.as.mutation(api.users.deleteAccount, {});

    expect(await authRows(t, ana.authId)).toEqual({ user: null, session: null, account: null });
    const kept = await authRows(t, bo.authId);
    expect(kept.user).not.toBeNull();
    expect(kept.session).not.toBeNull();
  });

  test("leaves nothing to sign in as", async () => {
    const { ana } = await twoPeople();
    await ana.as.mutation(api.users.deleteAccount, {});

    expect(await ana.as.query(api.users.viewer)).toBeNull();
    await expect(ana.as.mutation(api.users.deleteAccount, {})).rejects.toThrow();
  });
});

