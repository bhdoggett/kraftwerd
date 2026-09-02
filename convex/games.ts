import { ConvexError, v } from "convex/values";
import {
  BLANKS_PER_GAME,
  BOT_NAMES,
  GAME,
  RACK,
  RULES_VERSION,
  type Difficulty,
} from "../shared/config.js";
import { OPEN_BOARD, boardShapeNamed } from "../shared/boards.js";
import { gameName } from "../shared/gameNames.js";
import { cellKey, makeBoard, type TileSpec } from "../shared/engine/board.js";
import { makeDictionary } from "../shared/engine/dictionary.js";
import {
  applyPlacements,
  validateTurn,
  wordsFormed,
  type Fault,
} from "../shared/engine/legality.js";
import { draw, newBag, returnTiles, tilesLeft, type Bag } from "../shared/engine/bag.js";
import { scoreTurn, type Placement } from "../shared/engine/score.js";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { currentUser, displayName, refuseGuest, requireUser } from "./auth_helpers";
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
function boardShape(game: Doc<"games">) {
  const shape = boardShapeNamed(OPEN_BOARD, game.boardSize);
  return {
    width: game.boardSize,
    height: game.boardSize,
    blocked: shape.blocked,
    centre: shape.centre,
  };
}

/**
 * The game's bag, made on first use.
 *
 * Games dealt before there was a bag have none; they get one now rather than
 * a special case for the rest of their lives, which costs those games a
 * slightly fuller supply and nothing else.
 */
async function bagFor(ctx: MutationCtx, gameId: Id<"games">) {
  const row = await ctx.db
    .query("bags")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .unique();
  if (row !== null) return row;

  const id = await ctx.db.insert("bags", { gameId, letters: newBag(RACK) });
  return (await ctx.db.get("bags", id))!;
}

/**
 * Fill a rack back up from the bag, and write both down together.
 *
 * Rack and bag are one fact split across two rows: a tile is either in a hand
 * or in the bag, never both and never neither. They are written in the same
 * transaction so nothing can land between them.
 */
export async function drawInto(
  ctx: MutationCtx,
  gameId: Id<"games">,
  keep: readonly string[],
  putBack: readonly string[] = [],
) {
  const row = await bagFor(ctx, gameId);
  const returned = returnTiles(row.letters as Bag, putBack);
  const { drawn, bag } = draw(returned, RACK.size - keep.length, Math.random);

  await ctx.db.patch("bags", row._id, { letters: bag });
  return { letters: [...keep, ...drawn], left: tilesLeft(bag) };
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

export const difficulty = v.union(
  v.literal("easy"),
  v.literal("medium"),
  v.literal("hard"),
);

export const createGame = mutation({
  args: {
    playerCount: v.number(),
    /** A computer player per entry, at the difficulty given. */
    bots: v.optional(v.array(difficulty)),
  },
  handler: async (ctx, args) => {
    const me = await currentUser(ctx);
    const userId = me._id;
    const bots = args.bots ?? [];

    // A seat this game will wait for a person to take. A guest may fill every
    // seat itself, with machines, and no more than that.
    if (args.playerCount - 1 - bots.length > 0) refuseGuest(me);

    if (args.playerCount < GAME.minPlayers || args.playerCount > GAME.maxPlayers) {
      throw new ConvexError(`Games take ${GAME.minPlayers}-${GAME.maxPlayers} players`);
    }
    if (bots.length > args.playerCount - 1) {
      throw new ConvexError("There are not that many seats to fill");
    }

    const name = gameName(Math.random);
    const gameId = await ctx.db.insert("games", {
      name,
      layout: pickLayout(),
      status: "lobby",
      boardSize: GAME.boardSize,
      endThreshold: GAME.endThreshold,
      playerCount: args.playerCount,
      currentSeat: 0,
      turnNumber: 0,
      tileCount: 0,
      createdBy: userId,
      rulesVersion: RULES_VERSION,
    });

    await joinSeat(ctx, gameId, userId, 0);

    for (const [i, level] of bots.entries()) {
      await seatBot(ctx, gameId, i + 1, level);
    }

    // Nobody left to wait for: a solo game, or one whose other seats are all
    // machines. Either way it is playable at once.
    if (args.playerCount === 1 + bots.length) {
      await ctx.db.patch("games", gameId, { status: "active" });
      await wakeBot(ctx, gameId);
    }

    return { gameId, name, playerCount: args.playerCount };
  },
});

/**
 * Seat a computer player.
 *
 * It gets a users row of its own so everything that references a player by id
 * — tiles, scores, winners — works without knowing the difference. The row is
 * per game and per seat, so two bots at one table stay distinct.
 */
async function seatBot(
  ctx: MutationCtx,
  gameId: Id<"games">,
  seat: number,
  level: Difficulty,
) {
  const name = BOT_NAMES[seat % BOT_NAMES.length];
  const userId = await ctx.db.insert("users", {
    authId: `bot|${gameId}|${seat}`,
    name: `${name} (${level})`,
  });

  await joinSeat(ctx, gameId, userId, seat);
  const player = await ctx.db
    .query("players")
    .withIndex("by_game_and_seat", (q) => q.eq("gameId", gameId).eq("seat", seat))
    .unique();
  if (player !== null) await ctx.db.patch("players", player._id, { bot: level });
}

async function joinSeat(
  ctx: MutationCtx,
  gameId: Id<"games">,
  userId: Id<"users">,
  seat: number,
  status: "invited" | "joined" = "joined",
) {
  // A fresh rack, drawn server-side out of the game's own bag.
  const rack = await drawInto(ctx, gameId, []);

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
    const me = await currentUser(ctx);
    refuseGuest(me);
    const userId = me._id;

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
 * What you give up goes back into the bag before what you take comes out, so
 * a trade cannot draw the tiles it just returned — and an empty bag has
 * nothing to swap with, which is when trading stops being possible.
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
    const given = player.letters.filter((_, i) => chosen.includes(i));

    const bag = await bagFor(ctx, args.gameId);
    if (tilesLeft(bag.letters as Bag) === 0) {
      throw new ConvexError("The bag is empty — there is nothing to trade for");
    }

    const rack = await drawInto(ctx, args.gameId, kept, given);
    await ctx.db.patch("players", player._id, { letters: rack.letters });

    await noteSkippedTurn(ctx, game, userId, "trade");
    await advanceTurn(ctx, game, 0);
    await wakeBot(ctx, args.gameId);
    return null;
  },
});

/**
 * Record a turn where nothing was placed.
 *
 * A trade and a pass both hand the turn on without touching the board, and
 * both used to leave nothing behind — so the history skipped from one player
 * to the same player again with no account of why.
 */
async function noteSkippedTurn(
  ctx: MutationCtx,
  game: Doc<"games">,
  userId: Id<"users">,
  kind: "pass" | "trade",
) {
  await ctx.db.insert("turns", {
    gameId: game._id,
    turnNumber: game.turnNumber,
    userId,
    kind,
    placements: [],
    words: [],
    squares: [],
    score: 0,
  });
}

/**
 * Give up a turn outright.
 *
 * Only once the bag is empty. While there is anything left to draw, trading
 * is how you skip a turn, and it costs you the tiles you could not use —
 * passing freely instead would make that cost optional. But when the bag runs
 * dry trading stops being possible, and a rack that will not play anywhere
 * leaves nothing to do at all: without this the only button left is Resign,
 * which ends everyone's game and records it as abandoned when really the
 * tiles just ran out.
 */
export const passTurn = mutation({
  args: { gameId: v.id("games") },
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

    const bag = await bagFor(ctx, args.gameId);
    if (tilesLeft(bag.letters as Bag) > 0) {
      throw new ConvexError("There are still tiles in the bag — trade instead");
    }

    // Enough of these in a row and advanceTurn ends the game: nobody can
    // play and nobody can draw, so it is going nowhere.
    await noteSkippedTurn(ctx, game, userId, "pass");
    await advanceTurn(ctx, game, 0);
    await wakeBot(ctx, args.gameId);
    return null;
  },
});

/** Accept or decline an invitation to a game. */
export const respondToInvite = mutation({
  args: { gameId: v.id("games"), accept: v.boolean() },
  handler: async (ctx, args) => {
    const viewer = await currentUser(ctx);
    // Taking a seat somebody kept for you is the same promise as joining.
    if (args.accept) refuseGuest(viewer);
    const userId = viewer._id;

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
      await ctx.db.patch("games", args.gameId, {
        status: "finished",
        winnerIds: [],
        finishedAt: Date.now(),
      });
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
    return await playTurn(ctx, args.gameId, userId, args.placements);
  },
});

/**
 * A computer player's turn, played through the same code as anyone else's.
 *
 * Internal, so it cannot be called from a browser: it takes the player it acts
 * for rather than the signed-in caller, which is exactly the argument nobody
 * outside the server should get to choose. Empty placements are a pass, which
 * a bot needs and a person cannot ask for.
 */
export const playForBot = internalMutation({
  args: {
    gameId: v.id("games"),
    userId: v.id("users"),
    placements: v.array(placement),
  },
  handler: async (ctx, args) => {
    const game = await ctx.db.get("games", args.gameId);
    if (game === null || game.status !== "active") return null;

    if (args.placements.length === 0) {
      await noteSkippedTurn(ctx, game, args.userId, "pass");
      await advanceTurn(ctx, game, 0);
      await wakeBot(ctx, args.gameId);
      return null;
    }

    await playTurn(ctx, args.gameId, args.userId, args.placements);
    return null;
  },
});

async function playTurn(
  ctx: MutationCtx,
  gameId: Id<"games">,
  userId: Id<"users">,
  played: Placement[],
) {
  const args = { gameId, placements: played };
  {
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
    const before = makeBoard(existing.map(toSpec));
    const after = applyPlacements(before, placements);
    const dictionary = await lookUp(ctx, wordsFormed(after, placements));

    const legality = validateTurn(before, placements, dictionary, boardShape(game));
    if (!legality.ok) throw new ConvexError(describe(legality.faults));

    const score = scoreTurn(after, placements, { before });

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
      // and written on insert too: leaving it out let the count restart at one
      // the next time the row was read, which gave a square an extra life.
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
      kind: "play",
      placements: args.placements,
      words: wordsFormed(after, placements),
      squares: score.squares,
      score: score.total,
    });

    // Letters refill from the bag; blanks do not — they are a whole-game
    // allowance of their own (§5) and were never in it.
    const rack = await drawInto(ctx, args.gameId, remaining);
    await ctx.db.patch("players", player._id, {
      score: player.score + score.total,
      letters: rack.letters,
      blanks: blanksLeft(player) - placements.filter((p) => p.isBlank).length,
    });

    const played = await ctx.db.get("users", userId);
    if (played !== null && (game.rulesVersion ?? 0) === RULES_VERSION) {
      const user = await recordUnderCurrentRules(ctx, played);
      if (score.total > (user.bestTurnScore ?? 0)) {
        await ctx.db.patch("users", userId, { bestTurnScore: score.total });
      }
    }

    // Nothing left in the bag and nothing left in hand: the game ends here,
    // and whoever got out takes what everyone else is still holding.
    const out = rack.left === 0 && rack.letters.length === 0;
    await advanceTurn(ctx, game, placements.length, out, userId);
    await wakeBot(ctx, args.gameId);

    return { score: score.total, squares: score.squares };
  }
}

/** Give the seat on the move a nudge, if a machine holds it. */
async function wakeBot(ctx: MutationCtx, gameId: Id<"games">) {
  await ctx.scheduler.runAfter(0, internal.bots.scheduleIfBot, { gameId });
}

/** Blanks a player has left, reading rows made before they became a count. */
export function blanksLeft(player: Doc<"players">): number {
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
/**
 * A player's record, brought up to the rules now in force.
 *
 * The first thing that happens under a new version clears what older ones
 * set, rather than adding to it: a best score from a different bag and a
 * different rack never competed with today's. Done here, once, so a play and
 * a finish cannot each decide to clear separately -- and so the clear happens
 * before this game's own numbers land, never after.
 */
async function recordUnderCurrentRules(ctx: MutationCtx, user: Doc<"users">) {
  if ((user.statsVersion ?? 0) === RULES_VERSION) return user;

  const cleared = {
    statsVersion: RULES_VERSION,
    gamesPlayed: 0,
    wins: 0,
    bestGameScore: 0,
    bestTurnScore: 0,
  };
  await ctx.db.patch("users", user._id, cleared);
  return { ...user, ...cleared };
}

async function finishGame(
  ctx: MutationCtx,
  game: Doc<"games">,
  /** Who emptied their hand, when that is what ended the game. */
  wentOut?: Id<"users">,
) {
  const players = await ctx.db
    .query("players")
    .withIndex("by_game", (q) => q.eq("gameId", game._id))
    .take(GAME.maxPlayers);

  /*
   * Tiles left in hand when the tiles run out.
   *
   * Every letter is worth a point played, so it costs a point unplayed —
   * and the same points go to whoever got rid of theirs. That swing is what
   * makes emptying your hand worth racing for, and what makes sitting on a Q
   * at the end a decision rather than an accident.
   */
  if (wentOut !== undefined) {
    let gathered = 0;

    for (const player of players) {
      const stuck = player.letters.length;
      if (player.userId === wentOut || stuck === 0) continue;

      gathered += stuck;
      await ctx.db.patch("players", player._id, { score: player.score - stuck });
      player.score -= stuck;
    }

    const finisher = players.find((p) => p.userId === wentOut);
    if (finisher !== undefined && gathered > 0) {
      await ctx.db.patch("players", finisher._id, { score: finisher.score + gathered });
      finisher.score += gathered;
    }
  }

  const resigned = new Set(game.resignedBy ?? []);
  const eligible = players.filter((p) => !resigned.has(p.userId));

  const best = eligible.reduce((max, p) => Math.max(max, p.score), -Infinity);
  const winners = eligible.filter((p) => p.score === best).map((p) => p.userId);

  await ctx.db.patch("games", game._id, {
    status: "finished",
    winnerIds: winners,
    finishedAt: Date.now(),
  });

  /*
   * Only games played under the rules in force count toward a record.
   *
   * A game that began before a rules change finishes under the rules it
   * began with, and those scores never competed with today's -- a different
   * bag, a different rack, different scoring. It keeps its history and its
   * winner; it simply does not go in the record.
   */
  if ((game.rulesVersion ?? 0) !== RULES_VERSION) return;

  for (const player of players) {
    const found = await ctx.db.get("users", player.userId);
    if (found === null) continue;
    const user = await recordUnderCurrentRules(ctx, found);

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
        for (const seat of seated) {
          await ctx.db.delete("players", seat._id);
          // A machine's user row belongs to this game alone, so it goes with
          // it. A person's row obviously does not.
          if (seat.bot !== undefined) await ctx.db.delete("users", seat.userId);
        }
        const bag = await ctx.db
          .query("bags")
          .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
          .unique();
        if (bag !== null) await ctx.db.delete("bags", bag._id);
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
  /** Whether the bag is empty and the player who just moved has played out. */
  playedOut = false,
  /** Who that was, so their leftover swing can be settled. */
  wentOut?: Id<"users">,
) {
  const tileCount = game.tileCount + played;
  const turnNumber = game.turnNumber + 1;

  // A turn that only replaced letters grew the board by nothing, but it was
  // not a pass — the board changed, and so did the words on it. Counting it
  // as one ended a solo game the moment two such turns ran together.
  const consecutivePasses = played === 0 ? (game.consecutivePasses ?? 0) + 1 : 0;

  /*
   * The game runs until the tiles run out.
   *
   * The bag empties, everyone plays out what is left in their hands, and it
   * ends when somebody has nothing left to play. There used to be a count of
   * fifty tiles instead, which was a stand-in for a supply back when the draw
   * was endless and nothing could ever run out.
   */
  const endsAfterTurn = game.endsAfterTurn;

  // Two full rounds where nobody places anything: the game is going nowhere.
  const stalled = consecutivePasses >= game.playerCount * 2;
  const finished =
    playedOut || stalled || (endsAfterTurn !== undefined && game.turnNumber >= endsAfterTurn);

  await ctx.db.patch("games", game._id, {
    tileCount,
    turnNumber,
    consecutivePasses,
    currentSeat: (game.currentSeat + 1) % game.playerCount,
    ...(endsAfterTurn === undefined ? {} : { endsAfterTurn }),
  });

  if (finished) {
    await finishGame(ctx, { ...game, tileCount, endsAfterTurn }, playedOut ? wentOut : undefined);
  }
}

/*
 * A turn can be wrong in more than one way, and the client shows each on its
 * own line. Here they are one string, since a thrown error is one string --
 * joined rather than trimmed to the first, so a caller outside the app is
 * told everything that is wrong with what it sent.
 */
function describe(faults: readonly Fault[]): string {
  return faults.map(describeFault).join("; ");
}

function describeFault(legality: Fault): string {
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
    case "blank-on-stack":
      return `A blank cannot be the tile that closes a square (${legality.at.x}, ${legality.at.y})`;
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
/**
 * Every turn of a game, in the order they were taken.
 *
 * Enough to rebuild any position: a turn carries what it placed, so replaying
 * them in order gives the board as it stood at any point. Nothing here can
 * change the game -- winding back through the history is looking, not
 * undoing.
 */
export const listTurns = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    const game = await ctx.db.get("games", args.gameId);
    if (game === null) throw new ConvexError("No such game");

    const seated = await ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .take(GAME.maxPlayers);
    if (!seated.some((p) => p.userId === userId)) {
      throw new ConvexError("You are not in this game");
    }

    const rows = await ctx.db
      .query("turns")
      .withIndex("by_game_and_turn", (q) => q.eq("gameId", args.gameId))
      .take(MAX_TILES);

    return await Promise.all(
      rows
        .sort((a, b) => a.turnNumber - b.turnNumber)
        .map(async (turn) => ({
          turnNumber: turn.turnNumber,
          userId: turn.userId,
          name: displayName(await ctx.db.get("users", turn.userId)),
          seat: seated.find((p) => p.userId === turn.userId)?.seat ?? 0,
          // Rows written before anything but plays was recorded.
          kind: turn.kind ?? ("play" as const),
          placements: turn.placements,
          words: turn.words,
          squares: turn.squares,
          score: turn.score,
        })),
    );
  },
});

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
    // A query cannot make the bag, so a game that has not needed one yet
    // reports a full one: that is what it would be handed.
    const bag = await ctx.db
      .query("bags")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .unique();

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
      /**
       * How many tiles nobody has drawn yet. The count, never the contents —
       * knowing what is in the bag is knowing everyone's future draws.
       */
      tilesLeft: tilesLeft((bag?.letters ?? newBag(RACK)) as Bag),
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
        /** Which turn put it there, so the board can point out what is new. */
        turnNumber: t.turnNumber,
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
            /** Asked, but not yet sitting down. */
            invited: p.status === "invited",
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

        // Who the game is waiting on, by name: "your turn" answers the
        // question only when the answer is you.
        const inSeat = seated.find((other) => other.seat === game.currentSeat);
        const waitingFor =
          game.status !== "active" || inSeat === undefined
            ? null
            : displayName(await ctx.db.get("users", inSeat.userId));

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
          /** Whose turn it is, named. Null unless the game is under way. */
          waitingFor,
          invited: p.status === "invited",
          invitedBy: displayName(creator),
          youWon: (game.winnerIds ?? []).includes(p.userId),
          /** True when the game ended because someone quit. */
          abandoned: (game.resignedBy ?? []).length > 0,
          /**
           * When it ended, falling back to when it began for games that
           * finished before this was recorded.
           */
          endedAt: game.finishedAt ?? game._creationTime,
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
      // Finished games are history: kept, out of the way, and newest first --
      // the last game you played is the one you want to look at. Rows come
      // back in the order you joined the games, which is neither.
      past: mineOnly
        .filter((r) => r.status === "finished")
        .sort((a, b) => b.endedAt - a.endedAt),
    };
  },
});

