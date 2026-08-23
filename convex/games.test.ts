/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { BLANKS_PER_GAME, RACK } from "../shared/config";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Excludes test files: globbing them made each test module import the
// others, which reads as a dependency cycle and loads them needlessly.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/** Only the words these tests actually need. */
const WORDS = ["AD", "DO", "AT", "TO", "A", "I", "ACE", "CAM", "EMU", "EM"];

/**
 * Coordinates are given relative to the centre, since the opening word has to
 * cover it. `at(0, 0, ...)` is the centre square itself.
 */
const CENTRE = 7;
const at = (x: number, y: number, letter: string, isBlank = false) => ({
  x: x + CENTRE,
  y: y + CENTRE,
  letter,
  isBlank,
});

/** A two-player game, started, with both racks stocked with `letters`. */
async function twoPlayerGame(letters: string[]) {
  const t = convexTest(schema, modules);

  // Better Auth mirrors its user into this table via a trigger; the tests
  // create the mirrored row directly so the game logic can be exercised
  // without standing up the auth component.
  const [alice, bob] = await t.run(async (ctx) => {
    const a = await ctx.db.insert("users", { authId: "auth|alice", name: "Alice" });
    const b = await ctx.db.insert("users", { authId: "auth|bob", name: "Bob" });
    for (const word of WORDS) await ctx.db.insert("words", { word });
    return [a, b];
  });

  const asAlice = t.withIdentity({ subject: "auth|alice" });
  const asBob = t.withIdentity({ subject: "auth|bob" });

  const { gameId } = await asAlice.mutation(api.games.createGame, { playerCount: 2 });

  // Seat Bob directly and start the game. These tests are about placement
  // rules; the invitation flow that normally seats a second player has its
  // own tests below.
  await t.run(async (ctx) => {
    await ctx.db.insert("players", {
      gameId,
      userId: bob,
      seat: 1,
      score: 0,
      letters: [...letters],
      blanks: BLANKS_PER_GAME,
      blank: true,
      status: "joined",
    });
    await ctx.db.patch("games", gameId, { status: "active", layout: "Bars" });

    const players = await ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .take(4);
    for (const p of players) {
      await ctx.db.patch("players", p._id, {
        letters: [...letters],
        blanks: BLANKS_PER_GAME,
        blank: true,
      });
    }
  });

  return { t, gameId, asAlice, asBob, alice, bob };
}

describe("placeTiles", () => {
  test("scores a legal opening 2x2 and banks it to the player", async () => {
    const { gameId, asAlice, alice, t } = await twoPlayerGame(["A", "D", "D", "O"]);

    const result = await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A"), at(1, 0, "D"), at(0, 1, "D"), at(1, 1, "O")],
    });

    // Four 2-letter words (8) plus the square (2).
    expect(result).toEqual({ score: 10, squares: [2] });

    const player = await t.run(async (ctx) =>
      ctx.db
        .query("players")
        .withIndex("by_game_and_user", (q) => q.eq("gameId", gameId).eq("userId", alice))
        .unique(),
    );
    expect(player?.score).toBe(10);
  });

  test("refills the rack back to full after a play", async () => {
    const { gameId, asAlice, alice, t } = await twoPlayerGame(["A", "D", "D", "O"]);

    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A"), at(1, 0, "D"), at(0, 1, "D"), at(1, 1, "O")],
    });

    const player = await t.run(async (ctx) =>
      ctx.db
        .query("players")
        .withIndex("by_game_and_user", (q) => q.eq("gameId", gameId).eq("userId", alice))
        .unique(),
    );
    expect(player?.letters).toHaveLength(RACK.size);
    expect(player?.blank).toBe(true);
  });

  test("rejects a play from the player whose turn it is not", async () => {
    const { gameId, asBob } = await twoPlayerGame(["A", "D"]);

    await expect(
      asBob.mutation(api.games.placeTiles, {
        gameId,
        placements: [at(0, 0, "A"), at(1, 0, "D")],
      }),
    ).rejects.toThrow("Not your turn");
  });

  test("rejects letters the player does not hold", async () => {
    const { gameId, asAlice } = await twoPlayerGame(["A", "D"]);

    await expect(
      asAlice.mutation(api.games.placeTiles, {
        gameId,
        placements: [at(0, 0, "A"), at(1, 0, "T")],
      }),
    ).rejects.toThrow("do not hold the letter T");
  });

  test("rejects a word that is not in the dictionary", async () => {
    const { gameId, asAlice } = await twoPlayerGame(["D", "A"]);

    await expect(
      asAlice.mutation(api.games.placeTiles, {
        gameId,
        placements: [at(0, 0, "D"), at(1, 0, "A")],
      }),
    ).rejects.toThrow("Not a word: DA");
  });

  test("rejects a second play that does not touch the mass", async () => {
    const { gameId, asAlice, asBob } = await twoPlayerGame(["A", "D", "T", "O"]);

    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A"), at(1, 0, "D")],
    });

    await expect(
      asBob.mutation(api.games.placeTiles, {
        gameId,
        // Well clear of the mass, and clear of the premium corners.
        placements: [at(2, 2, "T"), at(3, 2, "O")],
      }),
    ).rejects.toThrow("connect to the tiles already on the board");
  });

  test("lets the opponent complete a square and take the whole thing", async () => {
    const { gameId, asAlice, asBob, bob, t } = await twoPlayerGame(["A", "D", "D", "O"]);

    // Alice builds three corners of the 2x2.
    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A"), at(1, 0, "D"), at(0, 1, "D")],
    });

    // Bob closes it with one tile and scores 4 + 2.
    const result = await asBob.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(1, 1, "O")],
    });
    // The closing tile takes both 2-letter words and the square.
    expect(result).toEqual({ score: 6, squares: [2] });

    const player = await t.run(async (ctx) =>
      ctx.db
        .query("players")
        .withIndex("by_game_and_user", (q) => q.eq("gameId", gameId).eq("userId", bob))
        .unique(),
    );
    expect(player?.score).toBe(6);
  });

  test("rotates the turn to the next seat", async () => {
    const { gameId, asAlice, t } = await twoPlayerGame(["A", "D"]);

    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A"), at(1, 0, "D")],
    });

    const game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game?.currentSeat).toBe(1);
    expect(game?.turnNumber).toBe(1);
    expect(game?.tileCount).toBe(2);
  });

  test("blanks are an allowance for the game, not one per turn", async () => {
    const { t, gameId, asAlice, alice } = await twoPlayerGame(["A", "D"]);

    // Two of the three in one turn is fine.
    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A", true), at(1, 0, "D", true)],
    });

    const player = await t.run(async (ctx) =>
      ctx.db
        .query("players")
        .withIndex("by_game_and_user", (q) => q.eq("gameId", gameId).eq("userId", alice))
        .unique(),
    );
    // Spent, and not handed back next turn.
    expect(player?.blanks).toBe(BLANKS_PER_GAME - 2);
  });

  test("cannot play more blanks than are left", async () => {
    const { t, gameId, asAlice, alice } = await twoPlayerGame(["A", "D"]);
    await t.run(async (ctx) => {
      const player = await ctx.db
        .query("players")
        .withIndex("by_game_and_user", (q) => q.eq("gameId", gameId).eq("userId", alice))
        .unique();
      await ctx.db.patch("players", player!._id, { blanks: 1 });
    });

    await expect(
      asAlice.mutation(api.games.placeTiles, {
        gameId,
        placements: [at(0, 0, "A", true), at(1, 0, "D", true)],
      }),
    ).rejects.toThrow("only 1 blanks left");
  });

  test("a blank scores no point but still counts in the square", async () => {
    const { gameId, asAlice } = await twoPlayerGame(["A", "D", "D"]);

    const result = await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A"), at(1, 0, "D"), at(0, 1, "D"), at(1, 1, "O", true)],
    });

    // Four 2-letter words, less the blank's letter in the two it sits in,
    // plus 2 for the square.
    expect(result).toEqual({ score: 8, squares: [2] });
  });
});

describe("getGame", () => {
  test("hides the opponent's letters but reveals your own", async () => {
    const { gameId, asAlice, alice, bob } = await twoPlayerGame(["A", "D"]);

    const view = await asAlice.query(api.games.getGame, { gameId });

    const players = view!.players;
    const mine = players.find((p: { userId: Id<"users"> }) => p.userId === alice);
    const theirs = players.find((p: { userId: Id<"users"> }) => p.userId === bob);

    expect(mine?.letters).toEqual(["A", "D"]);
    expect(theirs?.letters).toBeNull();
    expect(theirs?.letterCount).toBe(2);
  });
});

describe("end of game", () => {
  test("finishes only after the round completes, so seats get equal turns", async () => {
    const { t, gameId, asAlice, asBob } = await twoPlayerGame(["A", "D", "T", "O"]);

    // Drop the threshold to something these two turns will cross.
    await t.run(async (ctx) => {
      await ctx.db.patch("games", gameId, { endThreshold: 2 });
    });

    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A"), at(1, 0, "D")],
    });

    // Alice crossed the threshold at seat 0, so Bob still gets his turn.
    let game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game?.status).toBe("active");
    expect(game?.endsAfterTurn).toBe(1);

    await asBob.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 1, "D"), at(1, 1, "O")],
    });

    game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game?.status).toBe("finished");
  });

  test("rejects a play once the game has finished", async () => {
    const { t, gameId, asAlice } = await twoPlayerGame(["A", "D"]);

    await t.run(async (ctx) => {
      await ctx.db.patch("games", gameId, { status: "finished" });
    });

    await expect(
      asAlice.mutation(api.games.placeTiles, {
        gameId,
        placements: [at(0, 0, "A"), at(1, 0, "D")],
      }),
    ).rejects.toThrow("not active");
  });
});

describe("solo games", () => {
  test("a one-player game is active immediately, with nobody to wait for", async () => {
    const t = convexTest(schema, modules);
    const alice = await t.run(async (ctx) => {
      for (const word of WORDS) await ctx.db.insert("words", { word });
      return await ctx.db.insert("users", { authId: "auth|solo", name: "Solo" });
    });
    void alice;

    const asAlice = t.withIdentity({ subject: "auth|solo" });
    const { gameId } = await asAlice.mutation(api.games.createGame, { playerCount: 1 });

    const game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game?.status).toBe("active");
  });

  test("a two-player game still waits in the lobby", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => ctx.db.insert("users", { authId: "auth|a", name: "A" }));

    const { gameId } = await t
      .withIdentity({ subject: "auth|a" })
      .mutation(api.games.createGame, { playerCount: 2 });

    const game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game?.status).toBe("lobby");
  });
});

describe("resigning and stats", () => {
  test("quitting hands the win to the other player", async () => {
    const { t, gameId, asAlice, alice, bob } = await twoPlayerGame(["A", "D"]);
    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A"), at(1, 0, "D")],
    });

    await asAlice.mutation(api.games.resignGame, { gameId });

    const game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game?.status).toBe("finished");
    expect(game?.winnerIds).toEqual([bob]);
    expect(game?.resignedBy).toEqual([alice]);
  });

  test("a resigner cannot win even while ahead", async () => {
    const { t, gameId, asAlice, alice, bob } = await twoPlayerGame(["A", "D", "D", "O"]);

    // Alice scores 10, then quits anyway.
    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A"), at(1, 0, "D"), at(0, 1, "D"), at(1, 1, "O")],
    });
    await asAlice.mutation(api.games.resignGame, { gameId });

    const game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game?.winnerIds).toEqual([bob]);

    const users = await t.run(async (ctx) => ({
      alice: await ctx.db.get("users", alice),
      bob: await ctx.db.get("users", bob),
    }));
    expect(users.alice?.wins ?? 0).toBe(0);
    expect(users.bob?.wins).toBe(1);
    // The score still counts toward personal bests.
    expect(users.alice?.bestGameScore).toBe(10);
  });

  test("records the best single turn as it happens", async () => {
    const { t, gameId, asAlice, alice } = await twoPlayerGame(["A", "D", "D", "O"]);

    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A"), at(1, 0, "D"), at(0, 1, "D"), at(1, 1, "O")],
    });

    const user = await t.run(async (ctx) => ctx.db.get("users", alice));
    expect(user?.bestTurnScore).toBe(10);
  });

  test("counts a game for everyone who played, won or not", async () => {
    const { t, gameId, asAlice, alice, bob } = await twoPlayerGame(["A", "D"]);
    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A"), at(1, 0, "D")],
    });

    await asAlice.mutation(api.games.resignGame, { gameId });

    const users = await t.run(async (ctx) => ({
      alice: await ctx.db.get("users", alice),
      bob: await ctx.db.get("users", bob),
    }));
    expect(users.alice?.gamesPlayed).toBe(1);
    expect(users.bob?.gamesPlayed).toBe(1);
  });

  test("a finished game cannot be resigned again", async () => {
    const { gameId, asAlice } = await twoPlayerGame(["A", "D"]);
    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A"), at(1, 0, "D")],
    });
    await asAlice.mutation(api.games.resignGame, { gameId });

    await expect(
      asAlice.mutation(api.games.resignGame, { gameId }),
    ).rejects.toThrow("already over");
  });

  test("reaching the tile threshold records a winner", async () => {
    const { t, gameId, asAlice, asBob, alice } = await twoPlayerGame(["A", "D", "T", "O"]);
    await t.run(async (ctx) => {
      await ctx.db.patch("games", gameId, { endThreshold: 2 });
    });

    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A"), at(1, 0, "D")],
    });
    await asBob.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 1, "D"), at(1, 1, "O")],
    });

    const game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game?.status).toBe("finished");
    // Bob closed the 2x2 for 5; Alice took 2.
    expect(game?.winnerIds).toHaveLength(1);
    expect(game?.winnerIds?.[0]).not.toBe(alice);
  });
});

describe("game invitations", () => {
  async function invitedGame() {
    const t = convexTest(schema, modules);
    const [ana, bo] = await t.run(async (ctx) => {
      for (const word of WORDS) await ctx.db.insert("words", { word });
      const a = await ctx.db.insert("users", {
        authId: "auth|ana",
        name: "Ana",
        email: "ana@example.com",
      });
      const b = await ctx.db.insert("users", {
        authId: "auth|bo",
        name: "Bo",
        email: "bo@example.com",
      });
      await ctx.db.insert("friendships", {
        requesterId: a,
        addresseeId: b,
        status: "accepted",
      });
      return [a, b];
    });

    const asAna = t.withIdentity({ subject: "auth|ana" });
    const asBo = t.withIdentity({ subject: "auth|bo" });
    const gameId = await asAna.mutation(api.games.createGameWithFriends, {
      friendIds: [bo],
    });
    return { t, gameId, asAna, asBo, ana, bo };
  }

  test("an invited game waits in the lobby rather than starting", async () => {
    const { t, gameId } = await invitedGame();

    const game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game?.status).toBe("lobby");
  });

  test("the invitee sees an invitation, not a game to enter", async () => {
    const { asBo, asAna } = await invitedGame();

    const bo = await asBo.query(api.games.listMyGames);
    expect(bo.invitations).toHaveLength(1);
    expect(bo.games).toHaveLength(0);
    expect(bo.invitations[0]?.invitedBy).toBe("Ana");

    // The inviter is already in, so it is a game for them, not an invitation.
    const ana = await asAna.query(api.games.listMyGames);
    expect(ana.invitations).toHaveLength(0);
    expect(ana.games).toHaveLength(1);
  });

  test("accepting starts the game", async () => {
    const { t, gameId, asBo } = await invitedGame();

    await asBo.mutation(api.games.respondToInvite, { gameId, accept: true });

    const game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game?.status).toBe("active");
    expect((await asBo.query(api.games.listMyGames)).games).toHaveLength(1);
  });

  test("declining ends the game rather than leaving a lobby nobody can fill", async () => {
    const { t, gameId, asBo } = await invitedGame();

    await asBo.mutation(api.games.respondToInvite, { gameId, accept: false });

    const game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game?.status).toBe("finished");
  });

  test("an invitation cannot be answered twice", async () => {
    const { gameId, asBo } = await invitedGame();
    await asBo.mutation(api.games.respondToInvite, { gameId, accept: true });

    await expect(
      asBo.mutation(api.games.respondToInvite, { gameId, accept: true }),
    ).rejects.toThrow("already answered");
  });

  test("an uninvited player cannot answer", async () => {
    const { gameId, asAna } = await invitedGame();

    await expect(
      asAna.mutation(api.games.respondToInvite, { gameId, accept: true }),
    ).rejects.toThrow("already answered");
  });
});

describe("joining by link", () => {
  async function lobbyGame(playerCount: number) {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "auth|host", name: "Host" });
      await ctx.db.insert("users", { authId: "auth|guest", name: "Guest" });
      await ctx.db.insert("users", { authId: "auth|third", name: "Third" });
    });
    const asHost = t.withIdentity({ subject: "auth|host" });
    const { gameId } = await asHost.mutation(api.games.createGame, { playerCount });
    return { t, gameId, asHost, asGuest: t.withIdentity({ subject: "auth|guest" }),
      asThird: t.withIdentity({ subject: "auth|third" }) };
  }

  test("the game starts only once every seat is taken", async () => {
    const { t, gameId, asGuest, asThird } = await lobbyGame(3);

    await asGuest.mutation(api.games.joinGame, { gameId });
    let game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game?.status).toBe("lobby");

    await asThird.mutation(api.games.joinGame, { gameId });
    game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game?.status).toBe("active");
  });

  test("a full game cannot be joined", async () => {
    const { gameId, asGuest, asThird } = await lobbyGame(2);
    await asGuest.mutation(api.games.joinGame, { gameId });

    await expect(
      asThird.mutation(api.games.joinGame, { gameId }),
    ).rejects.toThrow("already started");
  });

  test("joining by link makes everyone at the table friends", async () => {
    const { gameId, asHost, asGuest, asThird } = await lobbyGame(3);

    await asGuest.mutation(api.games.joinGame, { gameId });
    await asThird.mutation(api.games.joinGame, { gameId });

    // All three can now start a game with each other without another link.
    for (const who of [asHost, asGuest, asThird]) {
      const list = await who.query(api.friends.listFriends);
      expect(list.friends).toHaveLength(2);
      expect(list.incoming).toHaveLength(0);
      expect(list.outgoing).toHaveLength(0);
    }
  });

  test("joining someone you already asked accepts, rather than duplicating", async () => {
    const { t, gameId, asHost, asGuest } = await lobbyGame(2);
    const [host, guest] = await t.run(async (ctx) => {
      const rows = await ctx.db.query("users").take(5);
      return [rows[0]!._id, rows[1]!._id];
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("friendships", {
        requesterId: host,
        addresseeId: guest,
        status: "pending",
      });
    });

    await asGuest.mutation(api.games.joinGame, { gameId });

    const list = await asHost.query(api.friends.listFriends);
    expect(list.friends).toHaveLength(1);
    expect(list.outgoing).toHaveLength(0);
  });

  test("you cannot take two seats", async () => {
    const { gameId, asGuest } = await lobbyGame(3);
    await asGuest.mutation(api.games.joinGame, { gameId });

    await expect(
      asGuest.mutation(api.games.joinGame, { gameId }),
    ).rejects.toThrow("Already joined");
  });
});

describe("the lobby's game lists", () => {
  test("a finished game moves out of your games and into past games", async () => {
    const { gameId, asAlice, asBob } = await twoPlayerGame(["A", "D"]);
    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A"), at(1, 0, "D")],
    });

    let alice = await asAlice.query(api.games.listMyGames);
    expect(alice.games).toHaveLength(1);
    expect(alice.past).toHaveLength(0);

    await asAlice.mutation(api.games.resignGame, { gameId });

    alice = await asAlice.query(api.games.listMyGames);
    expect(alice.games).toHaveLength(0);
    expect(alice.past).toHaveLength(1);
    expect(alice.past[0]?.youWon).toBe(false);
    expect(alice.past[0]?.abandoned).toBe(true);

    // The winner sees the same game, from the other side.
    const bob = await asBob.query(api.games.listMyGames);
    expect(bob.past[0]?.youWon).toBe(true);
  });

  test("a game abandoned before it began is not counted or kept", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "auth|host", name: "Host" });
    });
    const asHost = t.withIdentity({ subject: "auth|host" });
    const { gameId } = await asHost.mutation(api.games.createGame, { playerCount: 2 });

    await asHost.mutation(api.games.resignGame, { gameId });

    // Nobody ever played, so it is not a game you have played and lost.
    const viewer = await asHost.query(api.users.viewer);
    expect(viewer?.stats?.gamesPlayed).toBe(0);
    expect(viewer?.stats?.bestGameScore).toBe(0);

    const lists = await asHost.query(api.games.listMyGames);
    expect(lists.games).toHaveLength(0);
    expect(lists.past).toHaveLength(0);
  });

  test("leaving a game that has not started frees the seat and leaves it standing", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "auth|host", name: "Host" });
      await ctx.db.insert("users", { authId: "auth|guest", name: "Guest" });
    });
    const asHost = t.withIdentity({ subject: "auth|host" });
    const asGuest = t.withIdentity({ subject: "auth|guest" });
    const { gameId } = await asHost.mutation(api.games.createGame, { playerCount: 3 });
    await asGuest.mutation(api.games.joinGame, { gameId });

    await asGuest.mutation(api.games.resignGame, { gameId });

    // The host is still waiting for players, with the seat open again.
    const host = await asHost.query(api.games.listMyGames);
    expect(host.games).toHaveLength(1);
    expect(host.games[0]?.opponents).toHaveLength(0);
    expect((await asGuest.query(api.games.listMyGames)).games).toHaveLength(0);
  });

  test("quitting a game you have played in counts against your record", async () => {
    const { gameId, asAlice } = await twoPlayerGame(["A", "D"]);
    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A"), at(1, 0, "D")],
    });

    await asAlice.mutation(api.games.resignGame, { gameId });

    const viewer = await asAlice.query(api.users.viewer);
    expect(viewer?.stats?.gamesPlayed).toBe(1);
  });

  test("a solo game quit before the first turn leaves no record", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "auth|solo", name: "Solo" });
    });
    const asSolo = t.withIdentity({ subject: "auth|solo" });
    const { gameId } = await asSolo.mutation(api.games.createGame, { playerCount: 1 });

    await asSolo.mutation(api.games.resignGame, { gameId });

    const viewer = await asSolo.query(api.users.viewer);
    expect(viewer?.stats?.gamesPlayed).toBe(0);
    expect((await asSolo.query(api.games.listMyGames)).past).toHaveLength(0);
  });

  test("nobody's record moves when a started game is quit before a turn", async () => {
    const { gameId, asAlice, asBob } = await twoPlayerGame(["A", "D"]);

    await asAlice.mutation(api.games.resignGame, { gameId });

    // Bob was handed a win over a game that never happened; that is not a win.
    expect((await asBob.query(api.users.viewer))?.stats?.gamesPlayed).toBe(0);
    expect((await asBob.query(api.users.viewer))?.stats?.wins).toBe(0);
    expect((await asAlice.query(api.games.listMyGames)).past).toHaveLength(0);
  });
});

describe("trading tiles", () => {
  test("swaps the chosen letters and passes the turn", async () => {
    const { t, gameId, asAlice, alice } = await twoPlayerGame(["A", "B", "C", "D"]);

    await asAlice.mutation(api.games.tradeTiles, { gameId, indices: [0, 1] });

    const [player, game] = await t.run(async (ctx) => [
      await ctx.db
        .query("players")
        .withIndex("by_game_and_user", (q) => q.eq("gameId", gameId).eq("userId", alice))
        .unique(),
      await ctx.db.get("games", gameId),
    ]);

    // The kept letters are still there; the traded ones were replaced.
    expect(player?.letters).toContain("C");
    expect(player?.letters).toContain("D");
    expect(player?.letters).toHaveLength(RACK.size);
    // Turn moved on, and nothing was placed.
    expect(game?.currentSeat).toBe(1);
    expect(game?.tileCount).toBe(0);
  });

  test("trading everything is allowed", async () => {
    const { gameId, asAlice } = await twoPlayerGame(["A", "B", "C", "D", "E", "F"]);

    await expect(
      asAlice.mutation(api.games.tradeTiles, { gameId, indices: [0, 1, 2, 3, 4, 5] }),
    ).resolves.toBeNull();
  });

  test("cannot trade out of turn", async () => {
    const { gameId, asBob } = await twoPlayerGame(["A", "B"]);

    await expect(
      asBob.mutation(api.games.tradeTiles, { gameId, indices: [0] }),
    ).rejects.toThrow("Not your turn");
  });

  test("cannot trade nothing", async () => {
    const { gameId, asAlice } = await twoPlayerGame(["A", "B"]);

    await expect(
      asAlice.mutation(api.games.tradeTiles, { gameId, indices: [] }),
    ).rejects.toThrow("at least one");
  });

  test("a table that only trades ends rather than running forever", async () => {
    const { t, gameId, asAlice, asBob } = await twoPlayerGame(["A", "B"]);

    // Two full rounds of nobody placing anything.
    for (const who of [asAlice, asBob, asAlice, asBob]) {
      await who.mutation(api.games.tradeTiles, { gameId, indices: [0] });
    }

    const game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game?.status).toBe("finished");
  });

  test("placing resets the stalled count", async () => {
    const { t, gameId, asAlice, asBob } = await twoPlayerGame(["A", "D", "D", "O"]);

    await asAlice.mutation(api.games.tradeTiles, { gameId, indices: [0] });
    await asBob.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(0, 0, "A"), at(1, 0, "D")],
    });

    const game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game?.consecutivePasses).toBe(0);
    expect(game?.status).toBe("active");
  });
});

describe("the board", () => {
  test("the opening word must cover the centre", async () => {
    const { gameId, asAlice } = await twoPlayerGame(["A", "D"]);

    await expect(
      asAlice.mutation(api.games.placeTiles, {
        gameId,
        placements: [
          { x: 1, y: 1, letter: "A", isBlank: false },
          { x: 2, y: 1, letter: "D", isBlank: false },
        ],
      }),
    ).rejects.toThrow("cover the centre");
  });

  // Blocked squares are still a rule the engine enforces — see
  // shared/engine/legality.test.ts — but no board carries them now.

  test("new games are played on an open board", async () => {
    // The harness pins a drawn layout so the test above has a blocked square
    // to aim at, so this one makes its own game.
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "auth|open", name: "Open" });
    });
    const { gameId } = await t
      .withIdentity({ subject: "auth|open" })
      .mutation(api.games.createGame, { playerCount: 1 });

    const game = await t.run(async (ctx) => ctx.db.get("games", gameId));
    expect(game?.layout).toBe("Open");
    expect(game?.boardSize).toBe(15);
    expect(game?.endThreshold).toBe(50);
  });
});
