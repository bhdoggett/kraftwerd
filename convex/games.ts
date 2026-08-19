import { ConvexError, v } from "convex/values";
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
  if (identity === null) throw new ConvexError("Not signed in");

  const user = await ctx.db
    .query("users")
    .withIndex("by_authId", (q) => q.eq("authId", identity.subject))
    .unique();
  if (user === null) throw new ConvexError("No user record for this identity");

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
      throw new ConvexError(`Games take ${GAME.minPlayers}-${GAME.maxPlayers} players`);
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

    // A solo game has nobody to wait for, so it is playable at once.
    if (args.playerCount === 1) {
      await ctx.db.patch("games", gameId, { status: "active" });
    }

    return gameId;
  },
});

async function joinSeat(
  ctx: MutationCtx,
  gameId: Id<"games">,
  userId: Id<"users">,
  seat: number,
  status: "invited" | "joined" = "joined",
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
    status,
  });
}

/**
 * Create a game and seat the given friends immediately, so nobody has to pass
 * a link around. Only accepted friends may be seated -- otherwise anyone could
 * drag a stranger into a game.
 */
export const createGameWithFriends = mutation({
  args: { friendIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    const playerCount = args.friendIds.length + 1;
    if (playerCount < 2 || playerCount > GAME.maxPlayers) {
      throw new ConvexError(`Games take up to ${GAME.maxPlayers} players`);
    }
    if (new Set(args.friendIds).size !== args.friendIds.length) {
      throw new ConvexError("Duplicate player");
    }
    if (args.friendIds.includes(userId)) throw new ConvexError("You are already seated");

    for (const friendId of args.friendIds) {
      const [a, b] = await Promise.all([
        ctx.db
          .query("friendships")
          .withIndex("by_pair", (q) =>
            q.eq("requesterId", userId).eq("addresseeId", friendId),
          )
          .unique(),
        ctx.db
          .query("friendships")
          .withIndex("by_pair", (q) =>
            q.eq("requesterId", friendId).eq("addresseeId", userId),
          )
          .unique(),
      ]);
      const accepted = [a, b].some((edge) => edge?.status === "accepted");
      if (!accepted) throw new ConvexError("You are not friends with that player");
    }

    // Starts in the lobby: an invitation is an offer, not a seating.
    const gameId = await ctx.db.insert("games", {
      status: "lobby",
      boardSize: GAME.boardSize,
      endThreshold: GAME.endThreshold,
      playerCount,
      currentSeat: 0,
      turnNumber: 0,
      tileCount: 0,
      createdBy: userId,
    });

    await joinSeat(ctx, gameId, userId, 0, "joined");
    for (const [i, friendId] of args.friendIds.entries()) {
      await joinSeat(ctx, gameId, friendId, i + 1, "invited");
    }

    return gameId;
  },
});


/**
 * Take a free seat in a game you have the link to.
 *
 * Games made with `createGame` are filled this way: there is no public list,
 * so holding the link is the permission. Games made from the friends list use
 * invitations instead and have no free seats to take.
 */
export const joinGame = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    const game = await ctx.db.get("games", args.gameId);
    if (game === null) throw new ConvexError("No such game");
    if (game.status !== "lobby") throw new ConvexError("That game has already started");

    const players = await ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .take(GAME.maxPlayers);

    if (players.some((p) => p.userId === userId)) throw new ConvexError("Already joined");
    if (players.length >= game.playerCount) throw new ConvexError("Game is full");

    await joinSeat(ctx, args.gameId, userId, players.length, "joined");

    // Last seat taken: the game starts.
    if (players.length + 1 === game.playerCount) {
      await ctx.db.patch("games", args.gameId, { status: "active" });
    }
    return null;
  },
});

/** Accept or decline an invitation to a game. */
export const respondToInvite = mutation({
  args: { gameId: v.id("games"), accept: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    const game = await ctx.db.get("games", args.gameId);
    if (game === null) throw new ConvexError("No such game");

    const me = await ctx.db
      .query("players")
      .withIndex("by_game_and_user", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();
    if (me === null) throw new ConvexError("You were not invited to this game");
    if (me.status !== "invited") throw new ConvexError("You have already answered");

    if (!args.accept) {
      // The game can never fill now, so it ends rather than lingering as a
      // lobby nobody can enter.
      await ctx.db.delete("players", me._id);
      await ctx.db.patch("games", args.gameId, { status: "finished", winnerIds: [] });
      return null;
    }

    await ctx.db.patch("players", me._id, { status: "joined" });

    const players = await ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .take(GAME.maxPlayers);

    // Everyone in: the game starts.
    const waiting = players.filter((p) => p.status === "invited");
    if (waiting.length === 0 && players.length === game.playerCount) {
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
    if (game === null) throw new ConvexError("No such game");
    if (game.status !== "active") throw new ConvexError("Game is not active");

    const player = await ctx.db
      .query("players")
      .withIndex("by_game_and_user", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();
    if (player === null) throw new ConvexError("You are not in this game");
    if (player.seat !== game.currentSeat) throw new ConvexError("Not your turn");

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
    if (!legality.ok) throw new ConvexError(describe(legality));

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

    const user = await ctx.db.get("users", userId);
    if (user !== null && score.total > (user.bestTurnScore ?? 0)) {
      await ctx.db.patch("users", userId, { bestTurnScore: score.total });
    }

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
  if (blanks > 1) throw new ConvexError("Only one blank per turn");
  if (blanks === 1 && !player.blank) throw new ConvexError("You have no blank");

  const remaining = [...player.letters];
  for (const p of placements) {
    if (p.isBlank) continue;
    const i = remaining.indexOf(p.letter);
    if (i < 0) throw new ConvexError(`You do not hold the letter ${p.letter}`);
    remaining.splice(i, 1);
  }
  return remaining;
}

/**
 * Settle a finished game: decide the winners, then fold the result into every
 * player's lifetime stats.
 *
 * Players who resigned forfeit — they cannot win regardless of score. A tie
 * among the remaining leaders gives each of them a win.
 */
async function finishGame(ctx: MutationCtx, game: Doc<"games">) {
  const players = await ctx.db
    .query("players")
    .withIndex("by_game", (q) => q.eq("gameId", game._id))
    .take(GAME.maxPlayers);

  const resigned = new Set(game.resignedBy ?? []);
  const eligible = players.filter((p) => !resigned.has(p.userId));

  const best = eligible.reduce((max, p) => Math.max(max, p.score), -Infinity);
  const winners = eligible.filter((p) => p.score === best).map((p) => p.userId);

  await ctx.db.patch("games", game._id, { status: "finished", winnerIds: winners });

  for (const player of players) {
    const user = await ctx.db.get("users", player.userId);
    if (user === null) continue;

    await ctx.db.patch("users", user._id, {
      gamesPlayed: (user.gamesPlayed ?? 0) + 1,
      wins: (user.wins ?? 0) + (winners.includes(player.userId) ? 1 : 0),
      bestGameScore: Math.max(user.bestGameScore ?? 0, player.score),
    });
  }
}

/**
 * Quit a game. Any remaining player wins it; in a solo game this just ends it.
 */
export const resignGame = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    const game = await ctx.db.get("games", args.gameId);
    if (game === null) throw new ConvexError("No such game");
    if (game.status === "finished") throw new ConvexError("Game is already over");

    const player = await ctx.db
      .query("players")
      .withIndex("by_game_and_user", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();
    if (player === null) throw new ConvexError("You are not in this game");

    const resignedBy = [...new Set([...(game.resignedBy ?? []), userId])];
    await ctx.db.patch("games", args.gameId, { resignedBy });

    await finishGame(ctx, { ...game, resignedBy });
    return null;
  },
});

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
  });

  if (finished) await finishGame(ctx, { ...game, tileCount, endsAfterTurn });
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

/** Prefer a real name, fall back to the local part of the email. */
function displayName(user: Doc<"users"> | null): string {
  if (user === null) return "Unknown";
  if (user.name && user.name.trim() !== "") return user.name;
  if (user.email) return user.email.split("@")[0]!;
  return "Player";
}

/**
 * Which of these words are in the dictionary.
 *
 * Lets the client validate a play before it is submitted, without shipping
 * 59k words to the browser. The client works out which words its staged tiles
 * form and asks about just those — a handful per turn.
 */
export const checkWords = query({
  args: { words: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireUser(ctx);

    const unique = [...new Set(args.words.map((w) => w.toUpperCase()))].slice(0, 32);

    return await Promise.all(
      unique.map(async (word) => {
        const row = await ctx.db
          .query("words")
          .withIndex("by_word", (q) => q.eq("word", word))
          .unique();
        return { word, valid: row !== null };
      }),
    );
  },
});

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
    const seated = players.filter((p) => p.status !== "invited");

    return {
      /** A free seat, in a game filled by link rather than by invitation. */
      canJoin:
        you === undefined &&
        game.status === "lobby" &&
        players.length < game.playerCount,
      seatsFilled: seated.length,
      game,
      viewerUserId: userId,
      /** Null when the viewer is looking at a game they have not joined. */
      yourSeat: you?.seat ?? null,
      tiles: tiles.map((t) => ({
        x: t.x,
        y: t.y,
        letter: t.letter,
        isBlank: t.isBlank,
        placedBy: t.placedBy,
      })),
      // Racks are private: every player sees their own letters and only the
      // count of everyone else's.
      players: await Promise.all(
        players.map(async (p) => {
          const user = await ctx.db.get("users", p.userId);
          return {
            userId: p.userId,
            seat: p.seat,
            score: p.score,
            name: displayName(user),
            letters: p.userId === userId ? p.letters : null,
            letterCount: p.letters.length,
            blank: p.blank,
          };
        }),
      ),
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

    const rows = await Promise.all(
      mine.map(async (p) => {
        const game = await ctx.db.get("games", p.gameId);
        if (game === null) return null;

        const creator = await ctx.db.get("users", game.createdBy);
        return {
          gameId: game._id,
          status: game.status,
          playerCount: game.playerCount,
          tileCount: game.tileCount,
          yourSeat: p.seat,
          yourScore: p.score,
          yourTurn: game.status === "active" && game.currentSeat === p.seat,
          invited: p.status === "invited",
          invitedBy: displayName(creator),
          youWon: (game.winnerIds ?? []).includes(p.userId),
          /** True when the game ended because someone quit. */
          abandoned: (game.resignedBy ?? []).length > 0,
        };
      }),
    );

    const visible = rows.filter((r) => r !== null);
    const mineOnly = visible.filter((r) => !r.invited);

    return {
      // An invitation is not a game you are in yet, so it is kept separate:
      // the lobby offers accept/decline rather than a way in.
      invitations: visible.filter((r) => r.invited && r.status === "lobby"),
      games: mineOnly.filter((r) => r.status !== "finished"),
      // Finished games are history: kept, but out of the way.
      past: mineOnly.filter((r) => r.status === "finished"),
    };
  },
});

