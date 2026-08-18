import { v } from "convex/values";
import { GAME, RACK } from "../shared/config.js";
import { makeBoard, type TileSpec } from "../shared/engine/board.js";
import { makeDictionary } from "../shared/engine/dictionary.js";
import { applyPlacements, validateTurn, wordsFormed } from "../shared/engine/legality.js";
import { refill } from "../shared/engine/rack.js";
import { scoreTurn, type Placement } from "../shared/engine/score.js";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { placement } from "./schema";

/** Upper bound on tiles we ever read: the game ends at `endThreshold`. */
const MAX_TILES = 512;

/**
 * The signed-in player's app user row.
 *
 * Better Auth puts its user id in the JWT subject, so identity resolves with
 * one indexed read instead of a round-trip into the auth component. Convex has
 * already verified the token's signature and expiry; the component's extra
 * session check would only add revoke-before-expiry precision, which this game
 * does not need.
 */
async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new Error("Not signed in");

  const user = await ctx.db
    .query("users")
    .withIndex("by_authId", (q) => q.eq("authId", identity.subject))
    .unique();
  if (user === null) throw new Error("No user record for this identity");

  return user._id;
}

async function loadTiles(ctx: QueryCtx | MutationCtx, gameId: Id<"games">) {
  return await ctx.db
    .query("tiles")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .take(MAX_TILES);
}

const toSpec = (t: Doc<"tiles">): TileSpec => ({
  x: t.x,
  y: t.y,
  letter: t.letter,
  isBlank: t.isBlank,
});

/**
 * Look up only the words this turn actually forms. The dictionary lives in a
 * table rather than the function bundle, so validation fetches the handful of
 * words at stake instead of all 59k.
 */
async function lookUp(ctx: QueryCtx | MutationCtx, candidates: readonly string[]) {
  const found = await Promise.all(
    [...new Set(candidates)].map(async (word) => {
      const row = await ctx.db
        .query("words")
        .withIndex("by_word", (q) => q.eq("word", word))
        .unique();
      return row === null ? null : word;
    }),
  );
  return makeDictionary(found.filter((w): w is string => w !== null));
}

export const createGame = mutation({
  args: { playerCount: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    if (args.playerCount < GAME.minPlayers || args.playerCount > GAME.maxPlayers) {
      throw new Error(`Games take ${GAME.minPlayers}-${GAME.maxPlayers} players`);
    }

    const gameId = await ctx.db.insert("games", {
      status: "lobby",
      boardSize: GAME.boardSize,
      endThreshold: GAME.endThreshold,
      playerCount: args.playerCount,
      currentSeat: 0,
      turnNumber: 0,
      tileCount: 0,
      createdBy: userId,
    });

    await joinSeat(ctx, gameId, userId, 0);
    return gameId;
  },
});

async function joinSeat(
  ctx: MutationCtx,
  gameId: Id<"games">,
  userId: Id<"users">,
  seat: number,
) {
  // A fresh rack, drawn server-side: the client never sees the generator.
  const rack = refill([], Math.random, RACK);

  await ctx.db.insert("players", {
    gameId,
    userId,
    seat,
    score: 0,
    letters: rack.letters,
    blank: rack.blank,
  });
}

export const joinGame = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    const game = await ctx.db.get("games", args.gameId);
    if (game === null) throw new Error("No such game");
    if (game.status !== "lobby") throw new Error("Game already started");

    const players = await ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .take(GAME.maxPlayers);

    if (players.some((p) => p.userId === userId)) throw new Error("Already joined");
    if (players.length >= game.playerCount) throw new Error("Game is full");

    await joinSeat(ctx, args.gameId, userId, players.length);

    // Last seat filled: the game starts.
    if (players.length + 1 === game.playerCount) {
      await ctx.db.patch("games", args.gameId, { status: "active" });
    }
    return null;
  },
});

export const placeTiles = mutation({
  args: {
    gameId: v.id("games"),
    placements: v.array(placement),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    const game = await ctx.db.get("games", args.gameId);
    if (game === null) throw new Error("No such game");
    if (game.status !== "active") throw new Error("Game is not active");

    const player = await ctx.db
      .query("players")
      .withIndex("by_game_and_user", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();
    if (player === null) throw new Error("You are not in this game");
    if (player.seat !== game.currentSeat) throw new Error("Not your turn");

    const placements: Placement[] = args.placements.map((p) => ({
      ...p,
      letter: p.letter.toUpperCase(),
    }));

    const remaining = spendRack(player, placements);

    const before = makeBoard((await loadTiles(ctx, args.gameId)).map(toSpec));
    const after = applyPlacements(before, placements);
    const dictionary = await lookUp(ctx, wordsFormed(after, placements));

    const legality = validateTurn(before, placements, dictionary, {
      width: game.boardSize,
      height: game.boardSize,
    });
    if (!legality.ok) throw new Error(describe(legality));

    const score = scoreTurn(after, placements);

    for (const p of placements) {
      await ctx.db.insert("tiles", {
        gameId: args.gameId,
        x: p.x,
        y: p.y,
        letter: p.letter,
        isBlank: p.isBlank,
        placedBy: userId,
        turnNumber: game.turnNumber,
      });
    }

    await ctx.db.insert("turns", {
      gameId: args.gameId,
      turnNumber: game.turnNumber,
      userId,
      placements: args.placements,
      words: wordsFormed(after, placements),
      squares: score.squares,
      score: score.total,
    });

    // The blank slot refills every turn whether or not it was used (§5).
    const rack = refill(remaining, Math.random, RACK);
    await ctx.db.patch("players", player._id, {
      score: player.score + score.total,
      letters: rack.letters,
      blank: rack.blank,
    });

    await advanceTurn(ctx, game, placements.length);

    return { score: score.total, squares: score.squares };
  },
});

/**
 * Remove the played letters from the rack, or throw if the player does not
 * hold them. At most one blank per turn, since the rack holds one slot (§5).
 */
function spendRack(player: Doc<"players">, placements: readonly Placement[]): string[] {
  const blanks = placements.filter((p) => p.isBlank).length;
  if (blanks > 1) throw new Error("Only one blank per turn");
  if (blanks === 1 && !player.blank) throw new Error("You have no blank");

  const remaining = [...player.letters];
  for (const p of placements) {
    if (p.isBlank) continue;
    const i = remaining.indexOf(p.letter);
    if (i < 0) throw new Error(`You do not hold the letter ${p.letter}`);
    remaining.splice(i, 1);
  }
  return remaining;
}

/**
 * Rotate the seat and apply the end condition. Crossing the tile threshold
 * schedules the finish for the end of the current round rather than ending
 * immediately, so every player gets the same number of turns (§6).
 */
async function advanceTurn(ctx: MutationCtx, game: Doc<"games">, placed: number) {
  const tileCount = game.tileCount + placed;
  const turnNumber = game.turnNumber + 1;

  let endsAfterTurn = game.endsAfterTurn;
  if (endsAfterTurn === undefined && tileCount >= game.endThreshold) {
    // Finish once the last seat has played: seats run 0..playerCount-1.
    endsAfterTurn = game.turnNumber + (game.playerCount - 1 - game.currentSeat);
  }

  const finished = endsAfterTurn !== undefined && game.turnNumber >= endsAfterTurn;

  await ctx.db.patch("games", game._id, {
    tileCount,
    turnNumber,
    currentSeat: (game.currentSeat + 1) % game.playerCount,
    ...(endsAfterTurn === undefined ? {} : { endsAfterTurn }),
    ...(finished ? { status: "finished" as const } : {}),
  });
}

function describe(legality: Exclude<ReturnType<typeof validateTurn>, { ok: true }>): string {
  switch (legality.reason) {
    case "empty-turn":
      return "Place at least one tile";
    case "out-of-bounds":
      return `That square is off the board (${legality.at.x}, ${legality.at.y})`;
    case "occupied":
      return `There is already a tile at (${legality.at.x}, ${legality.at.y})`;
    case "duplicate-cell":
      return `Two tiles on the same square (${legality.at.x}, ${legality.at.y})`;
    case "disconnected":
      return "Every tile must connect to the tiles already on the board";
    case "invalid-words":
      return `Not a word: ${legality.words.join(", ")}`;
  }
}

export const getGame = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    const game = await ctx.db.get("games", args.gameId);
    if (game === null) return null;

    const players = await ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .take(GAME.maxPlayers);

    const tiles = await loadTiles(ctx, args.gameId);

    const you = players.find((p) => p.userId === userId);

    return {
      game,
      viewerUserId: userId,
      /** Null when the viewer is looking at a game they have not joined. */
      yourSeat: you?.seat ?? null,
      canJoin: you === undefined && game.status === "lobby" && players.length < game.playerCount,
      tiles: tiles.map((t) => ({
        x: t.x,
        y: t.y,
        letter: t.letter,
        isBlank: t.isBlank,
        placedBy: t.placedBy,
      })),
      // Racks are private: every player sees their own letters and only the
      // count of everyone else's.
      players: players.map((p) => ({
        userId: p.userId,
        seat: p.seat,
        score: p.score,
        letters: p.userId === userId ? p.letters : null,
        letterCount: p.letters.length,
        blank: p.blank,
      })),
    };
  },
});

export const listMyGames = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);

    const mine = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(50);

    return await Promise.all(
      mine.map(async (p) => {
        const game = await ctx.db.get("games", p.gameId);
        return game === null
          ? null
          : {
              gameId: game._id,
              status: game.status,
              playerCount: game.playerCount,
              tileCount: game.tileCount,
              yourSeat: p.seat,
              yourScore: p.score,
              yourTurn: game.status === "active" && game.currentSeat === p.seat,
            };
      }),
    ).then((rows) => rows.filter((r) => r !== null));
  },
});

export const listOpenGames = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);

    const games = await ctx.db
      .query("games")
      .withIndex("by_status", (q) => q.eq("status", "lobby"))
      .take(50);

    return await Promise.all(
      games.map(async (game) => {
        const players = await ctx.db
          .query("players")
          .withIndex("by_game", (q) => q.eq("gameId", game._id))
          .take(GAME.maxPlayers);
        return {
          gameId: game._id,
          playerCount: game.playerCount,
          joined: players.length,
          seats: players.map((p) => p.userId),
        };
      }),
    );
  },
});
