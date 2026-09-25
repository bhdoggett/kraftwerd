import { ConvexError, v } from "convex/values";
import {
  BLANKS_PER_GAME,
  GAME,
  RACK,
  RULES_VERSION,
  type Difficulty,
} from "../shared/config.js";
import { drawNames, NAMES, robotName } from "../shared/names.js";
import { OPEN_BOARD, boardShapeNamed } from "../shared/boards.js";
import { cellKey, makeBoard, type TileSpec } from "../shared/engine/board.js";
import { makeDictionary } from "../shared/engine/dictionary.js";
import {
  applyPlacements,
  validateTurn,
  wordsFormed,
  type Fault,
} from "../shared/engine/legality.js";
import {
  draw,
  newBag,
  returnTiles,
  tilesLeft,
} from "../shared/engine/bag.js";
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
import { friendIdsOf, namesFor, seatOf } from "./seats";
import { askToBeFriends, rowsBetween } from "./friends";
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
    bonusSquares: shape.bonusSquares,
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
  const returned = returnTiles(row.letters, putBack);
  const { drawn, bag } = draw(returned, RACK.size - keep.length, Math.random);

  await ctx.db.patch("bags", row._id, { letters: bag });
  return { letters: [...keep, ...drawn], left: tilesLeft(bag) };
}

/** Upper bound on tiles we ever read: the game ends at `endThreshold`. */
const MAX_TILES = 512;

export async function loadTiles(ctx: QueryCtx | MutationCtx, gameId: Id<"games">) {
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
async function lookUp(
  ctx: QueryCtx | MutationCtx,
  candidates: readonly string[],
) {
  const found = await Promise.all(
    [...new Set(candidates)].map(async (word) =>
      (await hasWord(ctx, word)) ? word : null,
    ),
  );
  return makeDictionary(found.filter((w): w is string => w !== null));
}

/** Whether the dictionary table has this word. */
export async function hasWord(ctx: QueryCtx | MutationCtx, word: string) {
  const row = await ctx.db
    .query("words")
    .withIndex("by_word", (q) => q.eq("word", word))
    .unique();
  return row !== null;
}

/** Everyone at a game, invited seats included. */
export async function seatedAt(ctx: QueryCtx | MutationCtx, gameId: Id<"games">) {
  return await ctx.db
    .query("players")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .take(GAME.maxPlayers);
}

/** Whoever sits in `seat`, or null if nobody does. */
async function inSeat(
  ctx: QueryCtx | MutationCtx,
  gameId: Id<"games">,
  seat: number,
) {
  return await ctx.db
    .query("players")
    .withIndex("by_game_and_seat", (q) =>
      q.eq("gameId", gameId).eq("seat", seat),
    )
    .unique();
}

/** The player whose move it is, or null if the seat is somehow empty. */
export async function seatOnTurn(
  ctx: QueryCtx | MutationCtx,
  game: Doc<"games">,
) {
  return await inSeat(ctx, game._id, game.currentSeat);
}

/**
 * The game and the caller's seat, for a move only the player on turn may make.
 *
 * Every such move -- a play, a trade, a pass -- starts with the same four
 * refusals, and they have to be the same four: a check one of them forgot is a
 * way to act out of turn.
 */
async function requireTurn(
  ctx: MutationCtx,
  gameId: Id<"games">,
  userId: Id<"users">,
) {
  const game = await ctx.db.get("games", gameId);
  if (game === null) throw new ConvexError("No such game");
  if (game.status !== "active") throw new ConvexError("Game is not active");

  const player = await seatOf(ctx, gameId, userId);
  if (player === null) throw new ConvexError("You are not in this game");
  if (player.seat !== game.currentSeat) throw new ConvexError("Not your turn");
  return { game, player };
}

/** A game still filling, and whoever has sat down at it so far. */
/**
 * A game still taking seats, and whoever has taken one so far.
 *
 * "Still taking seats" rather than "not started": a game among friends is
 * playable from the moment it is made (see `createGame`), so being under way
 * no longer means being full. What closes a game to newcomers is every seat
 * being spoken for, or the game being over -- and a public game reaches the
 * first of those before anybody has played at all.
 */
export async function requireLobby(ctx: MutationCtx, gameId: Id<"games">) {
  const game = await ctx.db.get("games", gameId);
  if (game === null) throw new ConvexError("No such game");
  if (game.status === "finished")
    throw new ConvexError("That game is already over");

  const players = await seatedAt(ctx, gameId);
  if (players.length >= game.playerCount)
    throw new ConvexError("That game has already started");

  return { game, players };
}

export const difficulty = v.union(
  v.literal("easy"),
  v.literal("medium"),
  v.literal("hard"),
);

/**
 * A computer player: how well it plays, and what it is called.
 *
 * The name is chosen where the game is set up, so that the opponent named on
 * the setup screen is the one that ends up at the table.
 */
export const botSeat = v.object({ level: difficulty, name: v.string() });

export const createGame = mutation({
  args: {
    playerCount: v.number(),
    /** A computer player per entry, seated next to you in the order given. */
    bots: v.optional(v.array(botSeat)),
    /**
     * Which colour the maker chose. Omitted keeps the old default of 0, so a
     * caller that has never heard of this (a test, `respondToInvite`'s own
     * bookkeeping) still gets the table it always got.
     */
    seat: v.optional(v.number()),
    /**
     * Listed for strangers to find. Only meaningful on a game with a seat no
     * name is against yet -- a full table has nothing to offer anybody.
     */
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const me = await currentUser(ctx);
    const userId = me._id;
    const bots = args.bots ?? [];

    // A seat this game will wait for a person to take. A guest may fill every
    // seat itself, with machines, and no more than that.
    if (args.playerCount - 1 - bots.length > 0) refuseGuest(me);

    if (
      args.playerCount < GAME.minPlayers ||
      args.playerCount > GAME.maxPlayers
    ) {
      throw new ConvexError(
        `Games take ${GAME.minPlayers}-${GAME.maxPlayers} players`,
      );
    }
    if (bots.length > args.playerCount - 1) {
      throw new ConvexError("There are not that many seats to fill");
    }
    const seat = args.seat ?? 0;
    if (seat < 0 || seat >= GAME.maxPlayers) {
      throw new ConvexError("Not a colour this game has");
    }
    // Bots take whatever colours the maker's choice left behind, in order --
    // they have no preference of their own to express. Worked out before the
    // game exists, rather than after, so the game's very first `currentSeat`
    // can be the lowest seat actually sat in -- not always 0, now that 0
    // is a colour rather than a guaranteed occupant.
    const botSeats = Array.from({ length: GAME.maxPlayers }, (_, i) => i)
      .filter((s) => s !== seat)
      .slice(0, bots.length);
    // The name arrives from the client, so it is checked against the pool
    // rather than trusted: a machine that could be called anything could be
    // called what one of the people at the table is called.
    for (const bot of bots) {
      if (!(NAMES as readonly string[]).includes(bot.name)) {
        throw new ConvexError("That is not a name a computer player can have");
      }
    }

    // A game is only worth listing if somebody could take a seat at it.
    const isPublic =
      args.isPublic === true && args.playerCount - 1 - bots.length > 0;

    /*
     * The maker's own disguise. One name, not a table's worth: seats filled
     * later draw their own in `joinGame` or `inviteToGame`, against the
     * aliases already dealt.
     *
     * The machines' names are passed in by hand here, and only here, because
     * the machines are not seated until below: every later draw finds them in
     * the `alias` of a row that already exists. Either way they are excluded,
     * so a table never reads as a Gawain sitting beside a Robo-Gawain.
     */
    const alias = isPublic
      ? drawNames(
          1,
          Math.random,
          bots.map((b) => b.name),
        )[0]
      : undefined;

    const gameId = await ctx.db.insert("games", {
      layout: pickLayout(),
      status: "lobby",
      boardSize: GAME.boardSize,
      endThreshold: GAME.endThreshold,
      playerCount: args.playerCount,
      currentSeat: Math.min(seat, ...botSeats),
      turnNumber: 0,
      tileCount: 0,
      createdBy: userId,
      isPublic,
      rulesVersion: RULES_VERSION,
    });

    await joinSeat(ctx, gameId, userId, seat, "joined", alias);

    for (const [i, bot] of bots.entries()) {
      await seatBot(ctx, gameId, botSeats[i], bot.level, bot.name);
    }

    /*
     * Who the game is for decides whether it waits.
     *
     * Among friends it is playable the moment it exists, on the maker's own
     * seat: a seat kept for somebody is a seat they will take, and staring at
     * an empty board until they do buys nothing. The turn waits at an empty
     * seat when it reaches one, and whoever sits down takes it.
     *
     * Offered to strangers it waits until it is full, which is what it always
     * did: nobody at a public table has agreed to anything yet, and a game
     * half-played before the second player arrives is a poor introduction.
     */
    if (isPublic !== true) {
      await ctx.db.patch("games", gameId, {
        status: "active",
        currentSeat: seat,
      });
      await wakeBot(ctx, gameId);
    }

    return { gameId, playerCount: args.playerCount };
  },
});

/**
 * Seat a computer player.
 *
 * It gets a users row of its own so everything that references a player by id
 * — tiles, scores, winners — works without knowing the difference. The row is
 * per game and per seat, so two bots at one table stay distinct.
 *
 * Its bare pool name goes in `alias` even though a machine has nothing to
 * hide. That is the one place every draw already looks to see what is spoken
 * for at this table, so writing it there is what stops a joiner being dealt
 * `Gawain` next to a seated `Robo-Gawain (easy)`. It is never rendered:
 * `namesFor` checks `bot` before it consults `alias`.
 */
async function seatBot(
  ctx: MutationCtx,
  gameId: Id<"games">,
  seat: number,
  level: Difficulty,
  name: string,
) {
  const userId = await ctx.db.insert("users", {
    authId: `bot|${gameId}|${seat}`,
    name: robotName(name, level),
  });

  await joinSeat(ctx, gameId, userId, seat, "joined", name);
  const player = await inSeat(ctx, gameId, seat);
  if (player !== null)
    await ctx.db.patch("players", player._id, { bot: level });
}

async function joinSeat(
  ctx: MutationCtx,
  gameId: Id<"games">,
  userId: Id<"users">,
  seat: number,
  status: "invited" | "joined" = "joined",
  alias?: string,
) {
  // A fresh rack, drawn server-side out of the game's own bag.
  const rack = await drawInto(ctx, gameId, []);

  await ctx.db.insert("players", {
    gameId,
    userId,
    seat,
    alias,
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
/**
 * Take a free seat in a game you have the link to.
 *
 * Games made with `createGame` are filled this way: there is no public list,
 * so holding the link is the permission. Games made from the friends list use
 * invitations instead and have no free seats to take.
 */
export const joinGame = mutation({
  args: {
    gameId: v.id("games"),
    /**
     * Which colour the joiner chose. Omitted takes the next open seat in
     * order, which is what every caller did before this existed.
     */
    seat: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const me = await currentUser(ctx);
    refuseGuest(me);
    const userId = me._id;

    const { game, players } = await requireLobby(ctx, args.gameId);

    if (players.some((p) => p.userId === userId))
      throw new ConvexError("Already joined");
    if (players.length >= game.playerCount)
      throw new ConvexError("Game is full");

    const seat = args.seat ?? players.length;
    if (seat < 0 || seat >= GAME.maxPlayers) {
      throw new ConvexError("Not a colour this game has");
    }
    // Two people cannot reach for the same colour: Convex runs this as one
    // transaction, so whichever request commits first is the one that gets
    // it, and the second sees this row and is told the truth rather than
    // silently taking the seat over.
    if (players.some((p) => p.seat === seat)) {
      throw new ConvexError("That colour is already taken");
    }

    /*
     * A seat at a public game comes with a name to wear, drawn against the
     * ones already dealt at this table so no two people share a disguise.
     *
     * The machines are in that reckoning: `seatBot` writes each one's bare
     * pool name into its `alias`, so this draw excludes them without knowing
     * they exist. The prefix tells the two kinds apart, but it does not make
     * `Gawain` beside `Robo-Gawain (easy)` a table anybody wants to read.
     */
    const alias =
      game.isPublic === true
        ? drawNames(
            1,
            Math.random,
            players
              .map((p) => p.alias)
              .filter((a): a is string => a !== undefined),
          )[0]
        : undefined;

    await joinSeat(ctx, args.gameId, userId, seat, "joined", alias);

    /*
     * The link is an invitation, and an invitation carries a request to be
     * friends -- from whoever sent it, to whoever followed it. A request, not
     * a friendship: ignore it and the game plays out exactly the same. Sitting
     * down used to settle it for you, everyone at the table at once, which
     * decided something on your behalf that you never agreed to.
     *
     * Only the maker. The others at the table did not invite you, and asking
     * on their behalf would be the same presumption in a smaller coat -- two
     * guests of the same host ask each other from inside the game, or not.
     *
     * Not at a public game at all. There the link was a list anyone can read,
     * and the whole point of the aliases is that these people have not met.
     */
    if (game.isPublic !== true) {
      await askToBeFriends(ctx, game.createdBy, userId);
    }

    /*
     * A game offered to strangers begins when its last seat is taken: nobody
     * there agreed to anything until everybody had.
     *
     * A game among friends was already under way, and may have been waiting
     * on this very seat -- the turn holds at an empty one rather than wrap
     * back round, so whoever sits down takes it. `waitingHere` asks whether
     * the seat being filled is the one the turn is held at, since a joiner
     * taking some other colour has no claim on a turn that is not theirs.
     */
    if (game.isPublic === true) {
      if (players.length + 1 === game.playerCount) {
        await ctx.db.patch("games", args.gameId, { status: "active" });
      }
      return null;
    }

    // The turn was held for want of anybody to pass it to, and here they are.
    if (game.turnHeld === true) {
      await ctx.db.patch("games", args.gameId, {
        currentSeat: seat,
        turnHeld: false,
      });
      await wakeBot(ctx, args.gameId);
    }
    return null;
  },
});

/** The friendship row linking two people, whichever way round it was made. */
async function friendshipBetween(
  ctx: MutationCtx,
  a: Id<"users">,
  b: Id<"users">,
) {
  const { mine, theirs } = await rowsBetween(ctx, a, b);
  return mine ?? theirs;
}

/** Throw unless these two have an accepted friendship. */
async function requireFriendship(
  ctx: MutationCtx,
  a: Id<"users">,
  b: Id<"users">,
) {
  const edge = await friendshipBetween(ctx, a, b);
  if (edge?.status !== "accepted") {
    throw new ConvexError("You are not friends with that player");
  }
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

    const { game, players } = await requireLobby(ctx, args.gameId);

    if (!players.some((p) => p.userId === userId)) {
      throw new ConvexError("You are not in this game");
    }

    /*
     * What is already spoken for at this table: the aliases dealt to the
     * people, and the machines' bare pool names, which `seatBot` writes into
     * the same field so that one set covers both.
     *
     * It grows as seats are dealt below. Drawing every invitation against this
     * one snapshot would let a single call hand the same name to two seats,
     * which is the mistake the taken set exists to prevent.
     */
    const taken = new Set(
      players.map((p) => p.alias).filter((a): a is string => a !== undefined),
    );

    let seat = players.length;
    for (const friendId of args.friendIds) {
      if (seat >= game.playerCount) throw new ConvexError("No seats left");
      if (players.some((p) => p.userId === friendId)) continue;
      await requireFriendship(ctx, userId, friendId);

      /*
       * An invited seat at a public game needs a disguise like any other.
       * This is the third path that creates one -- `createGame` and `joinGame`
       * both dealt a name and this one did not, so a stranger who joined a
       * game with two invited friends saw two seats both called "Player":
       * indistinguishable on the scoreboard, and "Player played FOO for 12"
       * in the history could have been either of them.
       */
      const alias =
        game.isPublic === true
          ? drawNames(1, Math.random, taken)[0]
          : undefined;
      if (alias !== undefined) taken.add(alias);

      await joinSeat(ctx, args.gameId, friendId, seat, "invited", alias);
      seat++;
    }
    return null;
  },
});

/**
 * Swap the whole rack for a fresh one, once a game, without losing the turn.
 *
 * Trading used to cost the turn, and nobody ever did it: a turn is worth far
 * more than a bad rack costs, so a trade put you further behind than the
 * letters it fixed. The swap is free instead, and scarce -- one a game -- and
 * all or nothing, so it is a reset rather than a way to fish for one letter.
 *
 * The rack goes back into the bag before the new one comes out, so some of
 * the same letters can come straight back. An empty bag has nothing to swap
 * with; the swap is gone for good once the bag runs out.
 *
 * No turn is recorded. The turn has not been taken -- the player still plays
 * or passes after this -- and the history is one row a turn.
 */
async function swapRack(
  ctx: MutationCtx,
  gameId: Id<"games">,
  userId: Id<"users">,
) {
  const { player } = await requireTurn(ctx, gameId, userId);

  if (player.swapped === true) {
    throw new ConvexError("You have already used your swap this game");
  }
  if (player.letters.length === 0) {
    throw new ConvexError("You have no letters to swap");
  }
  const bag = await bagFor(ctx, gameId);
  if (tilesLeft(bag.letters) === 0) {
    throw new ConvexError("The bag is empty — there is nothing to swap for");
  }

  const rack = await drawInto(ctx, gameId, [], player.letters);
  await ctx.db.patch("players", player._id, {
    letters: rack.letters,
    swapped: true,
  });
}

export const swapTiles = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await swapRack(ctx, args.gameId, userId);
    return null;
  },
});

/** A bot's swap: the same rule, for a seat the caller already knows. */
export const swapForBot = internalMutation({
  args: { gameId: v.id("games"), userId: v.id("users") },
  handler: async (ctx, args) => {
    await swapRack(ctx, args.gameId, args.userId);
    return null;
  },
});

/**
 * Record a turn where nothing was placed.
 *
 * A pass hands the turn on without touching the board, and used to leave
 * nothing behind -- so the history skipped from one player to the same
 * player again with no account of why. Old games also carry "trade" rows,
 * from when trading cost a turn.
 */
async function noteSkippedTurn(
  ctx: MutationCtx,
  game: Doc<"games">,
  userId: Id<"users">,
  kind: "pass",
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
 * Allowed at any time. It used to be allowed only once the bag was empty,
 * because until then trading was how you skipped a turn. The swap no longer
 * costs a turn (`swapTiles`), so a rack that will not play -- swap spent or
 * not -- needs this instead. A full round of passes ends the game
 * (`advanceTurn`).
 */
export const passTurn = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { game } = await requireTurn(ctx, args.gameId, userId);

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

    const me = await seatOf(ctx, args.gameId, userId);
    if (me === null) throw new ConvexError("You were not invited to this game");
    if (me.status !== "invited")
      throw new ConvexError("You have already answered");

    if (!args.accept) {
      /*
       * The game can never fill now, so it ends rather than lingering as a
       * lobby nobody can enter -- and it says who ended it. Everyone else at
       * the table is told the next time they open the app: a game that simply
       * disappeared out of the lobby reads as a bug rather than as an answer.
       */
      await ctx.db.delete("players", me._id);
      await ctx.db.patch("games", args.gameId, {
        status: "finished",
        winnerIds: [],
        finishedAt: Date.now(),
        declinedBy: userId,
      });
      return null;
    }

    await ctx.db.patch("players", me._id, { status: "joined" });

    const players = await seatedAt(ctx, args.gameId);

    // Everyone in: a game that was waiting on its last answer starts.
    const waiting = players.filter((p) => p.status === "invited");
    if (waiting.length === 0 && players.length === game.playerCount) {
      await ctx.db.patch("games", args.gameId, { status: "active" });
    }

    /*
     * Accepting is sitting down, so it takes a held turn the same way joining
     * by link does -- the seat was already yours, and the game was waiting on
     * somebody to fill it.
     */
    if (game.turnHeld === true) {
      await ctx.db.patch("games", args.gameId, {
        currentSeat: me.seat,
        turnHeld: false,
      });
      await wakeBot(ctx, args.gameId);
    }
    return null;
  },
});

/**
 * Play the same people again.
 *
 * Anyone who was at the table may ask for it, and the game is under way the
 * moment they do, on their own seat: the colours carry over, the colours are
 * the turn order, and asking for the rematch is taking the first turn of it.
 * Everybody else is invited back to the colour they had, and answers the way
 * they would answer any other invitation.
 *
 * The machines come back as they were, same seat and same difficulty. Half of
 * what makes a table the same table is who at it is hard to beat.
 */
export const rematch = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const me = await currentUser(ctx);
    const userId = me._id;

    const before = await ctx.db.get("games", args.gameId);
    if (before === null) throw new ConvexError("No such game");
    if (before.status !== "finished") {
      throw new ConvexError("That game is not over yet");
    }

    const players = await seatedAt(ctx, args.gameId);
    const mine = players.find((p) => p.userId === userId);
    if (mine === undefined) throw new ConvexError("You were not in this game");

    /*
     * A finished game with a seat missing was never a table: declining an
     * invitation ends the game and takes the decliner's seat away with it.
     * Playing "again" what nobody played would seat whoever is left against a
     * gap, and a rematch is supposed to be the same table over again.
     */
    if (players.length !== before.playerCount) {
      throw new ConvexError("That game never got going");
    }

    // Somebody at this table got there first. Theirs is the rematch.
    if (before.rematchId !== undefined) return { gameId: before.rematchId };

    const gameId = await ctx.db.insert("games", {
      layout: pickLayout(),
      status: "active",
      boardSize: GAME.boardSize,
      endThreshold: GAME.endThreshold,
      playerCount: before.playerCount,
      currentSeat: mine.seat,
      turnNumber: 0,
      tileCount: 0,
      createdBy: userId,
      /*
       * Carried rather than cleared. On a game with strangers the alias is
       * what each seat is known by, and `isPublic` is the flag that keeps the
       * real names hidden -- dropping it here would introduce everybody by
       * name to people they played a whole game without meeting. It lists the
       * game to nobody: only a game still in its lobby is offered around, and
       * this one is under way from the moment it exists.
       */
      isPublic: before.isPublic,
      rulesVersion: RULES_VERSION,
    });

    for (const player of players) {
      if (player.bot !== undefined) {
        await seatBot(ctx, gameId, player.seat, player.bot, player.alias ?? "");
        continue;
      }
      await joinSeat(
        ctx,
        gameId,
        player.userId,
        player.seat,
        player.userId === userId ? "joined" : "invited",
        player.alias,
      );
    }

    await ctx.db.patch("games", args.gameId, { rematchId: gameId });
    await wakeBot(ctx, gameId);
    return { gameId };
  },
});

/**
 * Games of yours that somebody turned down, and that you have not been told
 * about yet.
 *
 * Read off your own player rows rather than the games table: the decline
 * deletes only the decliner's seat, so everyone still owed the news still has
 * one. The decliner is excluded by construction -- their seat is gone -- and
 * anyone already told is filtered out below.
 */
export const declineNotices = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);

    const mine = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(LOBBY_ROWS);

    const notices = await Promise.all(
      mine.map(async (seat) => {
        const game = await ctx.db.get("games", seat.gameId);
        if (game?.declinedBy === undefined) return null;
        if ((game.declineSeenBy ?? []).includes(userId)) return null;

        const who = await ctx.db.get("users", game.declinedBy);
        return { gameId: game._id, name: displayName(who) };
      }),
    );

    return notices.filter((notice) => notice !== null);
  },
});

/** Take the news away, once it has been read. */
export const dismissDecline = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    const game = await ctx.db.get("games", args.gameId);
    if (game === null) return null;

    const seen = game.declineSeenBy ?? [];
    if (seen.includes(userId)) return null;

    await ctx.db.patch("games", args.gameId, {
      declineSeenBy: [...seen, userId],
    });
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
      /*
       * A pass is the one thing here that does not go through `playTurn`, and
       * so the one thing whose seat nothing else checks.
       *
       * That was harmless while a bot's turn was a transaction of its own: it
       * could not have read a board that had since moved. It is not harmless
       * now that the turn is an action -- a bot that decides to pass and is
       * overtaken by a person playing would otherwise spend that person's turn
       * instead of its own. Refuse quietly rather than throwing: the caller's
       * turn has simply already happened.
       */
      const passer = await seatOf(ctx, args.gameId, args.userId);
      if (passer === null || passer.seat !== game.currentSeat) return null;

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
    const { game, player } = await requireTurn(ctx, args.gameId, userId);

    const placements: Placement[] = args.placements.map((p) => ({
      ...p,
      letter: p.letter.toUpperCase(),
    }));

    const remaining = spendRack(player, placements);

    const existing = await loadTiles(ctx, args.gameId);
    const before = makeBoard(existing.map(toSpec));
    const after = applyPlacements(before, placements);
    const dictionary = await lookUp(ctx, wordsFormed(after, placements));

    const shape = boardShape(game);
    const legality = validateTurn(before, placements, dictionary, shape);
    if (!legality.ok) throw new ConvexError(describe(legality.faults));

    const score = scoreTurn(after, placements, {
      before,
      bonusSquares: shape.bonusSquares,
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
    const blanksHeld =
      blanksLeft(player) - placements.filter((p) => p.isBlank).length;
    await ctx.db.patch("players", player._id, {
      score: player.score + score.total,
      letters: rack.letters,
      blanks: blanksHeld,
    });

    const played = await ctx.db.get("users", userId);
    if (played !== null && (game.rulesVersion ?? 0) === RULES_VERSION) {
      const user = await recordUnderCurrentRules(ctx, played);
      if (score.total > (user.bestTurnScore ?? 0)) {
        await ctx.db.patch("users", userId, { bestTurnScore: score.total });
      }
    }

    await advanceTurn(ctx, game, placements.length);
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
function spendRack(
  player: Doc<"players">,
  placements: readonly Placement[],
): string[] {
  const used = placements.filter((p) => p.isBlank).length;
  const held = blanksLeft(player);
  if (used > held) {
    throw new ConvexError(
      held === 0
        ? "You have no blanks left"
        : `You have only ${held} blanks left`,
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
) {
  const players = await seatedAt(ctx, game._id);

  /*
   * No settlement for tiles left in hand.
   *
   * Going out used to take every other player's unplayed letters off their
   * score and add the total to the finisher's. That swing existed to make
   * emptying your hand worth racing for, back when going out ended the game
   * on the spot and the race was the only thing the ending rewarded.
   *
   * The final round replaces it. Everyone still to move gets a turn, so
   * nobody is caught holding tiles they were never given a chance to play,
   * and a penalty for holding them would now be charging players for the
   * hand the bag happened to leave them. A score is what you scored.
   *
   * `shared/sim/game.ts` never modelled the swing, so every figure in
   * design.md §6 was already measured under this rule.
   */

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
    if (game.status === "finished")
      throw new ConvexError("Game is already over");

    const player = await seatOf(ctx, args.gameId, userId);
    if (player === null) throw new ConvexError("You are not in this game");

    // Nobody has played yet, so there is nothing to lose: quitting cancels
    // rather than finishes. Recording it would put a game you never played
    // into your record, and a game nobody played into your history — and
    // would hand whoever is left a win over a game that never happened.
    if (game.turnNumber === 0) {
      /*
       * Whose game it is decides what leaving means, not what state it is in.
       * The maker walking away takes the game with them -- nobody else is
       * left holding a table they did not set. Anyone else just gives the
       * seat back, and the game goes on waiting for somebody to take it.
       *
       * This asked `status !== "lobby"` until games among friends became
       * playable from the moment they are made, at which point every such
       * game was "started" and a guest leaving cancelled it out from under
       * the person who made it.
       */
      if (game.createdBy === userId) {
        const seated = await seatedAt(ctx, args.gameId);
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
 * Rotate the seat and apply the end condition (§6).
 */
async function advanceTurn(
  ctx: MutationCtx,
  game: Doc<"games">,
  /** Tiles played, replacements included. */
  played: number,
) {
  const tileCount = game.tileCount + played;
  const turnNumber = game.turnNumber + 1;

  const seated = await seatedAt(ctx, game._id);
  const bag = await bagFor(ctx, game._id);

  /*
   * Out: nothing left in the bag and nothing left in hand. Blanks count. They
   * used to be left out of this, so a player could go out while still holding
   * three of them, which are the most valuable tiles on the table (§5). A
   * hand is empty when there is nothing in it, and a blank is something in it.
   *
   * A player who is out has nothing to do, so the rotation skips them.
   */
  const bagEmpty = tilesLeft(bag.letters) === 0;
  const isOut = (p: Doc<"players">) =>
    bagEmpty && p.letters.length === 0 && blanksLeft(p) === 0;
  const inPlay = seated.filter((p) => !isOut(p));

  /*
   * The next seat after this one, wrapping around -- not
   * `(currentSeat + 1) % playerCount`. Seats are colours now, chosen freely
   * from GAME.maxPlayers regardless of how many are actually at the table,
   * so a two-player game's seats need not be {0, 1}; they could just as
   * easily be {0, 2}, and modular arithmetic against the headcount would
   * advance play to a seat nobody sits in.
   */
  const occupiedSeats = seated.map((p) => p.seat).sort((a, b) => a - b);
  const playingSeats = inPlay.map((p) => p.seat).sort((a, b) => a - b);
  /*
   * Nobody to pass to yet: a game among friends is playable before its seats
   * are all spoken for, so the rotation can come round to a seat that has no
   * one in it. The turn holds where it is until somebody sits down and takes
   * it (`joinGame`, `respondToInvite`) rather than wrapping onto the one
   * player as though this were a solo game.
   */
  const waitingForSomebody = seated.length < game.playerCount;
  const nobodyAfterThem =
    occupiedSeats.find((s) => s > game.currentSeat) === undefined;
  const turnHeld = waitingForSomebody && nobodyAfterThem;
  const nextSeat = turnHeld
    ? game.currentSeat
    : (playingSeats.find((s) => s > game.currentSeat) ??
      playingSeats[0] ??
      game.currentSeat);

  const consecutivePasses =
    played === 0 ? (game.consecutivePasses ?? 0) + 1 : 0;

  /*
   * The game ends when everyone has gone out, or when a full round of the
   * players still holding tiles goes by with nobody placing anything. Going
   * out does not end it for anyone else: they play on until they go out too,
   * or until they pass a whole round in a row between them. A lone player
   * left holding tiles who passes ends it at once -- a round of one.
   *
   * A pass is only final that way. Passing one turn and playing the next is
   * fine, since somebody else's play may have opened up a spot.
   *
   * Never while the turn is held, though. A game waiting for somebody to take
   * a seat is not a table refusing to play; counting those would end a game
   * before its second player ever arrived.
   *
   * This used to fix a last turn when the first player went out, and give
   * everyone else exactly one more (`games.endsAfterTurn`, no longer set).
   */
  const everyoneOut = !waitingForSomebody && inPlay.length === 0;
  const roundOfPasses = !turnHeld && consecutivePasses >= inPlay.length;
  const finished = everyoneOut || roundOfPasses;

  await ctx.db.patch("games", game._id, {
    tileCount,
    turnNumber,
    consecutivePasses,
    currentSeat: nextSeat,
    turnHeld,
  });

  if (finished) {
    await finishGame(ctx, { ...game, tileCount });
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
      return "Every tile must connect to the tiles already on the board";
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

    const seated = await seatedAt(ctx, args.gameId);
    if (!seated.some((p) => p.userId === userId)) {
      throw new ConvexError("You are not in this game");
    }

    const rows = await ctx.db
      .query("turns")
      .withIndex("by_game_and_turn", (q) => q.eq("gameId", args.gameId))
      .take(MAX_TILES);

    /*
     * The history names people too -- "Alice played FOO for 12" -- so it goes
     * through the same builder as the board and the lobby. It read the users
     * table directly until it was noticed that anyone seated at a public game
     * could open the history panel and read every stranger's real name, which
     * is the leak the aliases exist to stop. Four callers, one rule.
     */
    const friends =
      game.isPublic === true
        ? await friendIdsOf(ctx, userId)
        : new Set<Id<"users">>();
    const names = await namesFor(ctx, userId, game, seated, friends);

    return rows
      .sort((a, b) => a.turnNumber - b.turnNumber)
      .map((turn) => ({
        turnNumber: turn.turnNumber,
        userId: turn.userId,
        name: names.get(turn.userId) ?? "Player",
        seat: seated.find((p) => p.userId === turn.userId)?.seat ?? 0,
        // Rows written before anything but plays was recorded.
        kind: turn.kind ?? ("play" as const),
        placements: turn.placements,
        words: turn.words,
        squares: turn.squares,
        score: turn.score,
      }));
  },
});

export const checkWords = query({
  args: { words: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireUser(ctx);

    const unique = [...new Set(args.words.map((w) => w.toUpperCase()))].slice(
      0,
      32,
    );

    return await Promise.all(
      unique.map(async (word) => ({ word, valid: await hasWord(ctx, word) })),
    );
  },
});

/**
 * Every letter not on the board and not in the viewer's own hand: the bag,
 * plus everybody else's racks, added together and attributed to nobody.
 *
 * Added up rather than subtracted from the board for two reasons. The board
 * cannot answer it -- a stacked square keeps one row with the top letter, so
 * the letter underneath it is not there to subtract -- and the two halves
 * being inseparable is the whole safety of it: an opponent's rack could be
 * recovered from this only with the bag, which never leaves the server.
 */
function unseenLetters(
  bag: Record<string, number>,
  players: readonly Doc<"players">[],
  viewerId: Id<"users">,
): Record<string, number> {
  const unseen: Record<string, number> = { ...bag };
  for (const player of players) {
    if (player.userId === viewerId) continue;
    for (const letter of player.letters) {
      unseen[letter] = (unseen[letter] ?? 0) + 1;
    }
  }
  return unseen;
}

export const getGame = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    const game = await ctx.db.get("games", args.gameId);
    if (game === null) return null;

    const players = await seatedAt(ctx, args.gameId);

    const tiles = await loadTiles(ctx, args.gameId);
    // A query cannot make the bag, so a game that has not needed one yet
    // reports a full one: that is what it would be handed.
    const bag = await ctx.db
      .query("bags")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .unique();

    const you = players.find((p) => p.userId === userId);
    const seated = players.filter((p) => p.status !== "invited");

    /*
     * The friend set is read once for the whole table, not once per seat, and
     * on a private game not at all.
     *
     * This is the hottest query in the app -- every player, every turn, live --
     * and on a private game nothing is masked, so the friendships are two
     * index scans whose answer cannot change a single name. The subscription
     * cost is the worse half: reading the friendship index puts it in this
     * query's read set, so accepting a friend request would re-run and re-push
     * every open board in the app.
     *
     * `listMyGames` reads it unconditionally on purpose, and that is not an
     * oversight: it spans many games of mixed visibility and hoists one set
     * across all of them, so skipping it would need every game to be private
     * and buys nothing when one is not.
     */
    const friends =
      game.isPublic === true
        ? await friendIdsOf(ctx, userId)
        : new Set<Id<"users">>();
    const names = await namesFor(ctx, userId, game, players, friends);

    return {
      layout: OPEN_BOARD,
      /**
       * A free seat, in a game filled by link rather than by invitation.
       *
       * Asked of the seats rather than of the status: a game among friends is
       * playable from the moment it is made, so being under way no longer
       * means being full. This read `status === "lobby"`, which stopped being
       * true for those games and took the colour picker with it.
       */
      canJoin: you === undefined && players.length < game.playerCount,
      seatsFilled: seated.length,
      /** The turn is waiting for somebody to take the seat it landed on. */
      turnHeld: game.turnHeld === true,
      game,
      /**
       * How many tiles nobody has drawn yet. The count, never the contents —
       * knowing what is in the bag is knowing everyone's future draws.
       *
       * Sending the contents was tried and taken back out. Board, your own
       * rack and the bag account for every tile in the game, so a client
       * holding all three subtracts out the other players' hands exactly —
       * in a two-hander, the opponent's rack letter for letter, and diffed
       * turn to turn, precisely what they just drew. What the bag holds is
       * the one fact at this table that cannot be public.
       *
       * The per-letter display that wanted it is fed from `unseen` below
       * instead.
       */
      tilesLeft: tilesLeft((bag?.letters ?? newBag(RACK))),
      /**
       * Every letter not on the board and not in your own hand: the bag and
       * the other players' racks, added together and attributed to nobody.
       *
       * This is what a player can already work out with a pencil — the
       * starting composition, less the board, less what they are holding —
       * so answering it outright gives away nothing they could not count.
       * What keeps it safe is that the two halves stay added up: recovering
       * an opponent's rack from this would take the bag, and the bag never
       * leaves this function.
       *
       * Summed from the bag and the racks rather than by subtracting the
       * board, because the board cannot answer it. A stacked square keeps
       * one row with the top letter and a count (see `tiles` in schema.ts),
       * so the letter underneath is not on the board to subtract — a client
       * doing this arithmetic itself would report every buried tile as still
       * out there. Invited seats count: a rack is dealt when the seat is
       * made, so those letters are out of the bag whether or not the answer
       * has come back yet.
       */
      unseen: unseenLetters(bag?.letters ?? newBag(RACK), players, userId),
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
      players: players.map((p) => ({
        userId: p.userId,
        seat: p.seat,
        score: p.score,
        name: names.get(p.userId) ?? "Player",
        letters: p.userId === userId ? p.letters : null,
        letterCount: p.letters.length,
        blanks: blanksLeft(p),
        /** Whether this game's one free swap is spent. */
        swapped: p.swapped === true,
        /** Asked, but not yet sitting down. */
        invited: p.status === "invited",
      })),
    };
  },
});

/** How many of a player's rows the lobby reads, newest first. */
const LOBBY_ROWS = 200;

export const listMyGames = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);

    /*
     * Newest first. An index is ordered by its fields and then by creation
     * time ascending, so this read used to `.take(50)` off the *front* -- the
     * fifty oldest games this player ever sat in. Past fifty, a game they had
     * just made was never in the window, and the lobby simply did not have it:
     * reachable by its link, invisible everywhere else. It is the same failure
     * `bench.squares` had, and for the same reason.
     *
     * The cap stays, because a query has to be bounded, and it is read here
     * rather than left as a bare number. What it cannot promise is an
     * unfinished game older than the cap -- for that the row would have to
     * carry whether its game had ended, which nothing writes today. Games in
     * play are few and recent; games finished are history, and history wants
     * the recent end anyway.
     */
    const mine = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(LOBBY_ROWS);

    /*
     * Read once for the whole lobby rather than once per game: who this player
     * is friends with is the same answer for every row.
     *
     * Unconditional, unlike `getGame`, which skips it on a private game. The
     * lobby spans games of mixed visibility, so the only way to skip it here
     * is for every game in the list to be private -- and the moment one is
     * public the read is needed anyway. One read across every row is cheap;
     * the branch would mostly not fire.
     */
    const friends = await friendIdsOf(ctx, userId);

    const rows = await Promise.all(
      mine.map(async (p) => {
        const game = await ctx.db.get("games", p.gameId);
        if (game === null) return null;

        // Who else is at the table, so the lobby says who a game is against
        // rather than just naming it.
        const seated = await seatedAt(ctx, game._id);
        const names = await namesFor(ctx, userId, game, seated, friends);

        const others = seated
          .filter((other) => other.userId !== p.userId)
          .map((other) => ({
            name: names.get(other.userId) ?? "Player",
            pending: other.status === "invited",
          }));

        // Who the game is waiting on, by name: "your turn" answers the
        // question only when the answer is you.
        const inSeat = seated.find((other) => other.seat === game.currentSeat);
        /*
         * Whose move it is, or null when that is nobody: a game still filling
         * its seats can be waiting on a person who has not arrived, and naming
         * the seat that holds the turn would name the player who last moved.
         */
        const waitingFor =
          game.status !== "active" ||
          game.turnHeld === true ||
          inSeat === undefined
            ? null
            : (names.get(inSeat.userId) ?? "Player");

        return {
          opponents: others,
          gameId: game._id,
          status: game.status,
          playerCount: game.playerCount,
          tileCount: game.tileCount,
          yourSeat: p.seat,
          yourScore: p.score,
          yourTurn: game.status === "active" && game.currentSeat === p.seat,
          /** Whose turn it is, named. Null unless the game is under way. */
          waitingFor,
          invited: p.status === "invited",
          /**
           * The creator is a player at their own game, so the masked map
           * covers them and the fallback is unreachable. It used to read the
           * creator's users row to fall back to a real name -- the one place
           * in the lobby that reached past the mask, for a case that cannot
           * happen, at the cost of a user read on every row.
           */
          invitedBy: names.get(game.createdBy) ?? "Player",
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
      /*
       * An invitation is not a game you are in yet, so it is kept separate:
       * the lobby offers accept/decline rather than a way in.
       *
       * Whether you have answered, not what state the game is in. This asked
       * for `status === "lobby"` back when an invited game could not start
       * without you -- now that a game among friends is playable while it
       * waits, that test dropped the invitation out of your lobby and left
       * you no way to accept it at all.
       */
      invitations: visible.filter((r) => r.invited && r.status !== "finished"),
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

/** How many public games the open list reads, newest first. */
const OPEN_ROWS = 100;

/** A game nobody joined stops being an invitation after this long. */
const OPEN_FOR_MS = 24 * 60 * 60 * 1000;

/**
 * Games with a seat spare that anybody may take.
 *
 * The one way into a game without knowing somebody first. Only games that
 * asked to be listed appear: a link sent to one person must not become a door
 * anyone can walk through.
 *
 * Names come from the same builder as everywhere else, so a stranger reads
 * aliases and a friend reads a friend -- who you are allowed to see is a fact
 * about the pair of you, not about which screen you are on.
 */
export const listOpenGames = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const friends = await friendIdsOf(ctx, userId);
    const fresh = Date.now() - OPEN_FOR_MS;

    const games = await ctx.db
      .query("games")
      .withIndex("by_public_and_status", (q) =>
        q.eq("isPublic", true).eq("status", "lobby"),
      )
      .order("desc")
      .take(OPEN_ROWS);

    const rows = await Promise.all(
      games.map(async (game) => {
        // A game nobody ever joined would otherwise sit in the list for good.
        if (game._creationTime < fresh) return null;

        const seated = await seatedAt(ctx, game._id);

        if (seated.length >= game.playerCount) return null;
        // Your own games are in your lobby already.
        if (seated.some((p) => p.userId === userId)) return null;

        const names = await namesFor(ctx, userId, game, seated, friends);

        return {
          gameId: game._id,
          playerCount: game.playerCount,
          seatsFilled: seated.length,
          /** Who is waiting, as this viewer may see them, and which colour
              each one holds -- so a joiner can see what's still open. */
          players: seated.map((p) => ({
            name: names.get(p.userId) ?? "Player",
            seat: p.seat,
          })),
        };
      }),
    );

    return { games: rows.filter((r) => r !== null) };
  },
});
