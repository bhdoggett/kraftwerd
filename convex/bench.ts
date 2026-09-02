/**
 * The bot bench: seats machines without going through auth, so `convex run`
 * can drive turns on a development deployment and the platform's own
 * `executionTime` can be read back out of `convex logs --jsonl`.
 *
 * This exists because the bot's search knobs are chosen on measurement and
 * nobody could re-run that measurement without it. See `scripts/bench-bot.sh`
 * for the driver, and the note above the `squares` option in `bots.ts` for
 * what the numbers came out as.
 *
 * Gated on DEV_TOOLS like everything else in `dev.ts`: these fabricate users
 * and take other people's turns, and production has no such variable.
 */
import { ConvexError, v } from "convex/values";
import { GAME, BLANKS_PER_GAME } from "../shared/config.js";
import { drawInto } from "./games.js";
import { internal } from "./_generated/api";
import {
  env,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";

function requireDevTools(ctx: QueryCtx | MutationCtx) {
  void ctx;
  if (env.DEV_TOOLS !== "1") {
    throw new ConvexError("Dev tools are not enabled on this deployment");
  }
}

async function seat(
  ctx: MutationCtx,
  gameId: Id<"games">,
  userId: Id<"users">,
  index: number,
  bot: "easy" | "medium" | "hard" | undefined,
) {
  const rack = await drawInto(ctx, gameId, []);
  await ctx.db.insert("players", {
    gameId,
    userId,
    seat: index,
    score: 0,
    letters: rack.letters,
    blanks: BLANKS_PER_GAME,
    blank: true,
    status: "joined",
    ...(bot === undefined ? {} : { bot }),
  });
}

/**
 * A two-seat game tagged with `tag`, so a whole sweep row can be read back
 * afterwards. `bots` of 1 leaves a person at seat 1, which stops the game
 * after the opening move; 2 lets the machines play each other out.
 */
async function makeGame(ctx: MutationCtx, bots: number, tag: string) {
  const stamp = `${Date.now()}-${Math.random()}`;
  const users = await Promise.all(
    [0, 1].map((i) =>
      ctx.db.insert("users", { authId: `bench|${stamp}|${i}`, name: `Bench ${i}` }),
    ),
  );

  const gameId = await ctx.db.insert("games", {
    name: tag,
    layout: "open",
    status: "lobby",
    boardSize: GAME.boardSize,
    endThreshold: GAME.endThreshold,
    playerCount: 2,
    currentSeat: 0,
    turnNumber: 0,
    tileCount: 0,
    createdBy: users[0],
  });
  await seat(ctx, gameId, users[0], 0, "hard");
  await seat(ctx, gameId, users[1], 1, bots === 2 ? "hard" : undefined);
  await ctx.db.patch("games", gameId, { status: "active" });
  return gameId;
}

/** One opening move per game -- the worst case on an empty board. */
export const opening = internalMutation({
  args: { games: v.number(), tag: v.string() },
  handler: async (ctx, args) => {
    requireDevTools(ctx);
    for (let i = 0; i < args.games; i++) {
      const gameId = await makeGame(ctx, 1, args.tag);
      await ctx.scheduler.runAfter(0, internal.bots.takeTurn, { gameId });
    }
    return null;
  },
});

/** Two machines playing each other out, for whole-game figures. */
export const wholeGame = internalMutation({
  args: { games: v.number(), tag: v.string() },
  handler: async (ctx, args) => {
    requireDevTools(ctx);
    for (let i = 0; i < args.games; i++) {
      const gameId = await makeGame(ctx, 2, args.tag);
      await ctx.scheduler.runAfter(0, internal.bots.takeTurn, { gameId });
    }
    return null;
  },
});

/**
 * What the games carrying this tag came to.
 *
 * Turns are read per game through `by_game_and_turn`, and not with one
 * `.take(n)` over the whole table. An earlier version did the latter, and once
 * the deployment had accumulated a few thousand turns it silently returned the
 * *oldest* n -- which reported one sweep row as all zeros and quietly
 * understated another. Every figure in `bots.ts` was recomputed after that was
 * fixed.
 */
export const squares = internalQuery({
  args: { tag: v.string() },
  handler: async (ctx, args) => {
    requireDevTools(ctx);
    const games = (await ctx.db.query("games").take(6000)).filter(
      (g) => g.name === args.tag,
    );

    let turnCount = 0;
    let plays = 0;
    let wordCount = 0;
    let score = 0;
    let big = 0;
    const kinds: Record<string, number> = {};

    for (const game of games) {
      const turns = await ctx.db
        .query("turns")
        .withIndex("by_game_and_turn", (q) => q.eq("gameId", game._id))
        .take(200);
      for (const turn of turns) {
        turnCount++;
        score += turn.score;
        kinds[turn.kind ?? "play"] = (kinds[turn.kind ?? "play"] ?? 0) + 1;
        if (turn.words.length > 0) {
          plays++;
          wordCount += new Set(turn.words).size;
        }
        big += turn.squares.filter((k) => k >= 3).length;
      }
    }

    const n = games.length || 1;
    return {
      games: games.length,
      turns: turnCount,
      kinds,
      plays,
      wordsPerPlay: plays === 0 ? 0 : wordCount / plays,
      squares3plus: big,
      squaresPerGame: big / n,
      meanScore: score / n,
    };
  },
});
