import { ConvexError, v } from "convex/values";
import { BLANKS_PER_GAME, GAME, RACK } from "../shared/config.js";
import { OPEN_BOARD, boardShapeNamed } from "../shared/boards.js";
import { livePremium, premiumCells, premiumMap } from "../shared/premium.js";
import { gameName } from "../shared/gameNames.js";
import { cellKey, makeBoard, type TileSpec } from "../shared/engine/board.js";
import { makeDictionary } from "../shared/engine/dictionary.js";
import { applyPlacements, validateTurn, wordsFormed } from "../shared/engine/legality.js";
import { refill } from "../shared/engine/rack.js";
import { scoreTurn, type Placement } from "../shared/engine/score.js";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { displayName, requireUser } from "./auth_helpers";
import { placement } from "./schema";

/**
 * New games are played on an open board.
 *
 * The drawn layouts in shared/boards.ts and the blocked-square rules are both
 * kept — games already dealt one still work — but nothing hands one out.
 */
function pickLayout(): string {
  return OPEN_BOARD;
}

/**
 * The board a game is played on.
 *
 * Every game is open, including ones dealt a drawn layout before boards
 * stopped carrying blocked squares — otherwise those games would keep
 * enforcing a shape the board no longer draws.
 */
function boardShape(game: Doc<"games">, tiles: readonly Doc<"tiles">[] = []) {
  const shape = boardShapeNamed(OPEN_BOARD, game.boardSize);
  return {
    width: game.boardSize,
    height: game.boardSize,
    blocked: shape.blocked,
    centre: shape.centre,
    // Only corners still showing their letter: a corner somebody has covered
    // holds a played tile, which has to connect like any other.
    premium: new Set(livePremiumOf(game, tiles).map((c) => cellKey(c.x, c.y))),
  };
}

/** A game's premium corners, minus any square that has a tile on it. */
function livePremiumOf(
  game: Doc<"games">,
  covered: readonly { x: number; y: number }[],
) {
  return livePremium(premiumOf(game), covered);
}

/** The game's premium corners. Older games have none and play without them. */
function premiumOf(game: Doc<"games">) {
  return game.premium ?? [];
}

/**
 * The board as the rules see it: the tiles played, plus the letters the board
 * itself brought. The premium letters are not rows in `tiles` — nobody played
 * them, they cannot be taken back, and counting them would end the game four
 * tiles early.
 */
function boardWithPremium(game: Doc<"games">, tiles: readonly Doc<"tiles">[]) {
  return makeBoard([
    ...livePremium(premiumOf(game), tiles).map((c) => ({
      x: c.x,
      y: c.y,
      letter: c.letter,
      isBlank: false,
    })),
    ...tiles.map(toSpec),
  ]);
}

/** Upper bound on tiles we ever read: the game ends at `endThreshold`. */
const MAX_TILES = 512;

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
  stacked: t.stacked,
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

    const name = gameName(Math.random);
    const gameId = await ctx.db.insert("games", {
      name,
      layout: pickLayout(),
      premium: premiumCells(GAME.boardSize, Math.random),
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

    return { gameId, name, playerCount: args.playerCount };
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
    blanks: BLANKS_PER_GAME,
    blank: true,
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
      await requireFriendship(ctx, userId, friendId);
    }

    // Starts in the lobby: an invitation is an offer, not a seating.
    const gameId = await ctx.db.insert("games", {
      name: gameName(Math.random),
      layout: pickLayout(),
      premium: premiumCells(GAME.boardSize, Math.random),
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

    // Sitting down together is itself the introduction, so no request is
    // needed: everyone already at the table becomes a friend, which is what
    // makes a second game possible without passing another link around.
    for (const other of players) {
      await befriend(ctx, userId, other.userId);
    }

    // Last seat taken: the game starts.
    if (players.length + 1 === game.playerCount) {
      await ctx.db.patch("games", args.gameId, { status: "active" });
    }
    return null;
  },
});

/** The friendship row linking two people, whichever way round it was made. */
async function friendshipBetween(ctx: MutationCtx, a: Id<"users">, b: Id<"users">) {
  const [forward, back] = await Promise.all([
    ctx.db
      .query("friendships")
      .withIndex("by_pair", (q) => q.eq("requesterId", a).eq("addresseeId", b))
      .unique(),
    ctx.db
      .query("friendships")
      .withIndex("by_pair", (q) => q.eq("requesterId", b).eq("addresseeId", a))
      .unique(),
  ]);
  return forward ?? back;
}

/** Throw unless these two have an accepted friendship. */
async function requireFriendship(ctx: MutationCtx, a: Id<"users">, b: Id<"users">) {
  const edge = await friendshipBetween(ctx, a, b);
  if (edge?.status !== "accepted") {
    throw new ConvexError("You are not friends with that player");
  }
}

/**
 * Link the two players as friends, unless they already are. Idempotent, and
 * safe in either direction: a pending request from either side is accepted
 * rather than duplicated.
 */
async function befriend(ctx: MutationCtx, a: Id<"users">, b: Id<"users">) {
  if (a === b) return;

  const existing = await friendshipBetween(ctx, a, b);
  if (existing !== null) {
    if (existing.status !== "accepted") {
      await ctx.db.patch("friendships", existing._id, { status: "accepted" });
    }
    return;
  }

  await ctx.db.insert("friendships", {
    requesterId: a,
    addresseeId: b,
    status: "accepted",
  });
}

/**
 * Invite friends to a game that is still filling. Separate from creation so a
 * game can be made first and its seats offered afterwards -- by link, by
 * invitation, or a mix of the two.
 */
export const inviteToGame = mutation({
  args: { gameId: v.id("games"), friendIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    const game = await ctx.db.get("games", args.gameId);
    if (game === null) throw new ConvexError("No such game");
    if (game.status !== "lobby") throw new ConvexError("That game has already started");

    const players = await ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .take(GAME.maxPlayers);

    if (!players.some((p) => p.userId === userId)) {
      throw new ConvexError("You are not in this game");
    }

    let seat = players.length;
    for (const friendId of args.friendIds) {
      if (seat >= game.playerCount) throw new ConvexError("No seats left");
      if (players.some((p) => p.userId === friendId)) continue;
      await requireFriendship(ctx, userId, friendId);

      await joinSeat(ctx, args.gameId, friendId, seat, "invited");
      seat++;
    }
    return null;
  },
});

/**
 * Swap chosen letters for new ones and forfeit the turn.
 *
 * Letters are generated rather than drawn from a finite bag, so there is
 * nothing to run out of and no limit on how often this can be done.
 */
export const tradeTiles = mutation({
  args: { gameId: v.id("games"), indices: v.array(v.number()) },
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

    const chosen = [...new Set(args.indices)];
    if (chosen.length === 0) throw new ConvexError("Choose at least one tile");
    if (chosen.some((i) => i < 0 || i >= player.letters.length)) {
      throw new ConvexError("You do not hold that tile");
    }

    const kept = player.letters.filter((_, i) => !chosen.includes(i));
    const rack = refill(kept, Math.random, RACK);

    await ctx.db.patch("players", player._id, { letters: rack.letters });

    await advanceTurn(ctx, game, 0);
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

    const existing = await loadTiles(ctx, args.gameId);
    const before = boardWithPremium(game, existing);
    const after = applyPlacements(before, placements);
    const dictionary = await lookUp(ctx, wordsFormed(after, placements));

    const legality = validateTurn(before, placements, dictionary, boardShape(game, existing));
    if (!legality.ok) throw new ConvexError(describe(legality));

    // Words and squares touching a premium corner are worth double — but only
    // a corner still showing its letter. Burying one this turn forfeits it.
    const score = scoreTurn(after, placements, {
      premium: premiumMap(livePremiumOf(game, [...existing, ...placements])),
      before,
    });

    const tileAt = new Map(existing.map((t) => [cellKey(t.x, t.y), t]));

    for (const p of placements) {
      const sitting = tileAt.get(cellKey(p.x, p.y));
      const tile = {
        letter: p.letter,
        isBlank: p.isBlank,
        placedBy: userId,
        turnNumber: game.turnNumber,
      };

      // A tile landing on a tile replaces its letter rather than stacking a
      // second letter into the square: the board holds one letter a square,
      // and the square was already counted. Depth climbs regardless, so the
      // cap and the bonus can see how deep this square has been built.
      //
      // Taken from the board the engine just built rather than counted here,
      // so a premium corner is the square's first tile in the database as
      // well as in the rules. Written on insert too: leaving it out let the
      // count restart at one the next time the row was read, which handed a
      // covered corner an extra life.
      const depth = after.get(cellKey(p.x, p.y))?.stacked ?? 1;

      if (sitting === undefined) {
        await ctx.db.insert("tiles", {
          gameId: args.gameId,
          x: p.x,
          y: p.y,
          ...tile,
          stacked: depth,
        });
      } else {
        await ctx.db.patch("tiles", sitting._id, { ...tile, stacked: depth });
      }
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

    // Letters refill; blanks do not -- they are a whole-game allowance (§5).
    const rack = refill(remaining, Math.random, RACK);
    await ctx.db.patch("players", player._id, {
      score: player.score + score.total,
      letters: rack.letters,
      blanks: blanksLeft(player) - placements.filter((p) => p.isBlank).length,
    });

    const user = await ctx.db.get("users", userId);
    if (user !== null && score.total > (user.bestTurnScore ?? 0)) {
      await ctx.db.patch("users", userId, { bestTurnScore: score.total });
    }

    await advanceTurn(ctx, game, placements.length);

    return { score: score.total, squares: score.squares };
  },
});

/** Blanks a player has left, reading rows made before they became a count. */
function blanksLeft(player: Doc<"players">): number {
  return player.blanks ?? (player.blank ? 1 : 0);
}

/**
 * Remove the played letters from the rack, or throw if the player does not
 * hold them. Blanks are spent from a whole-game allowance (§5).
 */
function spendRack(player: Doc<"players">, placements: readonly Placement[]): string[] {
  const used = placements.filter((p) => p.isBlank).length;
  const held = blanksLeft(player);
  if (used > held) {
    throw new ConvexError(
      held === 0 ? "You have no blanks left" : `You have only ${held} blanks left`,
    );
  }

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

    // Nobody has played yet, so there is nothing to lose: quitting cancels
    // rather than finishes. Recording it would put a game you never played
    // into your record, and a game nobody played into your history — and
    // would hand whoever is left a win over a game that never happened.
    if (game.turnNumber === 0) {
      if (game.status !== "lobby" || game.createdBy === userId) {
        const seated = await ctx.db
          .query("players")
          .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
          .take(GAME.maxPlayers);
        for (const seat of seated) await ctx.db.delete("players", seat._id);
        await ctx.db.delete("games", args.gameId);
      } else {
        // Somebody else's game, still waiting for players: give the seat back
        // rather than calling the whole thing off.
        await ctx.db.delete("players", player._id);
      }
      return null;
    }

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
async function advanceTurn(
  ctx: MutationCtx,
  game: Doc<"games">,
  /** Tiles played, replacements included. */
  played: number,
) {
  // Every tile played counts towards the end, whether it filled an empty
  // square or landed on one that was taken: the game is a supply of tiles, and
  // stacking spends them like anything else.
  const tileCount = game.tileCount + played;
  const turnNumber = game.turnNumber + 1;

  // A turn that only replaced letters grew the board by nothing, but it was
  // not a pass — the board changed, and so did the words on it. Counting it
  // as one ended a solo game the moment two such turns ran together.
  const consecutivePasses = played === 0 ? (game.consecutivePasses ?? 0) + 1 : 0;

  let endsAfterTurn = game.endsAfterTurn;
  if (endsAfterTurn === undefined && tileCount >= game.endThreshold) {
    // Finish once the last seat has played: seats run 0..playerCount-1.
    endsAfterTurn = game.turnNumber + (game.playerCount - 1 - game.currentSeat);
  }

  // Two full rounds where nobody places anything: the game is going nowhere.
  const stalled = consecutivePasses >= game.playerCount * 2;
  const finished =
    stalled || (endsAfterTurn !== undefined && game.turnNumber >= endsAfterTurn);

  await ctx.db.patch("games", game._id, {
    tileCount,
    turnNumber,
    consecutivePasses,
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
    case "duplicate-cell":
      return `Two tiles on the same square (${legality.at.x}, ${legality.at.y})`;
    case "stack-full":
      return `That square is full (${legality.at.x}, ${legality.at.y})`;
    case "blocked":
      return `That square cannot be played on (${legality.at.x}, ${legality.at.y})`;
    case "missing-centre":
      return "The first word has to cover the centre square";
    case "disconnected":
      return "Every tile must connect to the tiles already on the board";;
    case "unchanged":
      return `The tile at (${legality.at.x}, ${legality.at.y}) is the same letter that is already there — a tile has to change the letter it covers`;
    case "erased":
      return legality.words.length === 1
        ? `${legality.words[0]} was already on the board and would be covered completely — a word already played has to keep at least one of its letters`
        : `${legality.words.join(", ")} were already on the board and would be covered completely — a word already played has to keep at least one of its letters`;
    case "invalid-words":
      return `Not a word: ${legality.words.join(", ")}`;
  }
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
      layout: OPEN_BOARD,
      /** A free seat, in a game filled by link rather than by invitation. */
      canJoin:
        you === undefined &&
        game.status === "lobby" &&
        players.length < game.playerCount,
      seatsFilled: seated.length,
      game,
      /** The corners this game was dealt, so the board can draw them. */
      premium: premiumOf(game),
      viewerUserId: userId,
      /** Null when the viewer is looking at a game they have not joined. */
      yourSeat: you?.seat ?? null,
      tiles: tiles.map((t) => ({
        x: t.x,
        y: t.y,
        letter: t.letter,
        isBlank: t.isBlank,
        placedBy: t.placedBy,
        stacked: t.stacked ?? 1,
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
            blanks: blanksLeft(p),
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

        // Who else is at the table, so the lobby says who a game is against
        // rather than just naming it.
        const seated = await ctx.db
          .query("players")
          .withIndex("by_game", (q) => q.eq("gameId", game._id))
          .take(GAME.maxPlayers);
        const others = await Promise.all(
          seated
            .filter((other) => other.userId !== p.userId)
            .map(async (other) => ({
              name: displayName(await ctx.db.get("users", other.userId)),
              pending: other.status === "invited",
            })),
        );

        return {
          opponents: others,
          gameId: game._id,
          name: game.name ?? "Game",
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

