import { ConvexError, v } from "convex/values";
import { OPEN_BOARD, boardShapeNamed } from "../shared/boards.js";
import { makeBoard, type TileSpec } from "../shared/engine/board.js";
import { coach, type HintResult } from "../shared/sim/coach.js";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { requireUser } from "./auth_helpers";
import { blanksLeft, loadTiles } from "./games.js";
import { hintResult } from "./hintResult";
import { lexicon } from "./lexicon";
import { seatOf } from "./seats";

/**
 * What a hint is worked out from, or the answer already worked out.
 *
 * Refuses anybody but the player on turn in a practice game. Reads the board
 * and that player's own rack -- never the bag and never another rack, which
 * would let a hint see what nobody at the table can.
 */
export const hintState = internalQuery({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const game = await ctx.db.get("games", args.gameId);
    if (game === null) throw new ConvexError("No such game");
    if (game.hints !== true) throw new ConvexError("Hints are off in this game");
    if (game.status !== "active") throw new ConvexError("This game is not being played");

    const me = await seatOf(ctx, args.gameId, userId);
    if (me === null) throw new ConvexError("You are not in this game");
    if (me.seat !== game.currentSeat) throw new ConvexError("Hints are for your own turn");

    const cached = await ctx.db
      .query("hints")
      .withIndex("by_game_user_turn", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId).eq("turnNumber", game.turnNumber),
      )
      .unique();
    if (cached !== null) return { kind: "cached" as const, result: cached.result };

    const tiles = await loadTiles(ctx, args.gameId);
    return {
      kind: "search" as const,
      userId,
      turnNumber: game.turnNumber,
      boardSize: game.boardSize,
      letters: me.letters,
      blanks: blanksLeft(me),
      tiles: tiles.map(
        (t): TileSpec => ({
          x: t.x,
          y: t.y,
          letter: t.letter,
          isBlank: t.isBlank,
          stacked: t.stacked ?? 1,
        }),
      ),
    };
  },
});

type HintState =
  | { kind: "cached"; result: HintResult }
  | {
      kind: "search";
      userId: Id<"users">;
      turnNumber: number;
      boardSize: number;
      letters: string[];
      blanks: number;
      tiles: TileSpec[];
    };

/** Keep a turn's hints. A second search for the same turn (two tabs) loses quietly. */
export const saveHint = internalMutation({
  args: {
    gameId: v.id("games"),
    userId: v.id("users"),
    turnNumber: v.number(),
    result: hintResult,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("hints")
      .withIndex("by_game_user_turn", (q) =>
        q.eq("gameId", args.gameId).eq("userId", args.userId).eq("turnNumber", args.turnNumber),
      )
      .unique();
    if (existing === null) await ctx.db.insert("hints", args);
    return null;
  },
});

/**
 * The best plays for your rack this turn, and why they score.
 *
 * An action because the search is not a transaction and can take a second or
 * two; see convex/bots.ts for the same reasoning about bot turns.
 */
export const hints = action({
  args: { gameId: v.id("games") },
  returns: hintResult,
  handler: async (ctx, args): Promise<HintResult> => {
    const state: HintState = await ctx.runQuery(internal.coach.hintState, args);
    if (state.kind === "cached") return state.result;

    const shape = boardShapeNamed(OPEN_BOARD, state.boardSize);
    const coaching = coach(
      makeBoard(state.tiles),
      { letters: state.letters, blanks: state.blanks },
      lexicon("full"),
      lexicon("common"),
      shape,
      state.boardSize,
    );
    const result: HintResult = { turnNumber: state.turnNumber, ...coaching };

    await ctx.runMutation(internal.coach.saveHint, {
      gameId: args.gameId,
      userId: state.userId,
      turnNumber: state.turnNumber,
      result,
    });
    return result;
  },
});
