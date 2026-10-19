import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

/**
 * Stamp `seriesId` on rematches made before it was recorded.
 *
 * Those are linked only one step at a time: each game names the rematch made
 * from it in `rematchId`, and nothing names the game before. So the pass
 * reads games oldest first. A rematch is always newer than the game it was
 * made from, which means the game before has its series settled by the time
 * the pass reaches the one after -- and that holds across pages too, so it
 * can work a page at a time and schedule the rest.
 *
 * One kind of game already has a series that needs correcting: a rematch
 * made since series existed, from the middle of an old chain, was stamped
 * with the game it was made from, since that was the first game it could
 * see. Once that game has a series of its own, the rematch takes it too.
 *
 * Safe to run again: a game already in the right series is left alone.
 *
 *   npx convex run migrations:backfillSeries
 */
export const backfillSeries = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = args.pageSize ?? 200;
    const page = await ctx.db
      .query("games")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: pageSize });

    // Settled earlier in this page: the rows read for the page do not see
    // their own patches.
    const settled = new Map<Id<"games">, Id<"games">>();
    const seriesNow = (game: Doc<"games">) => settled.get(game._id) ?? game.seriesId;

    // What a game named as a series belongs to, now that it has been passed.
    const rootOf = async (id: Id<"games">) => {
      const known = settled.get(id);
      if (known !== undefined) return known;
      return (await ctx.db.get("games", id))?.seriesId ?? id;
    };

    let stamped = 0;
    for (const game of page.page) {
      let series = game._id;
      const named = seriesNow(game);
      if (named !== undefined) {
        series = await rootOf(named);
        if (series !== named) {
          await ctx.db.patch("games", game._id, { seriesId: series });
          settled.set(game._id, series);
          stamped++;
        }
      }

      if (game.rematchId === undefined) continue;
      const next = await ctx.db.get("games", game.rematchId);
      // A rematch that already names a series is put right when the pass
      // reaches it; only one that names none is stamped from here.
      if (next === null || seriesNow(next) !== undefined) continue;
      await ctx.db.patch("games", next._id, { seriesId: series });
      settled.set(next._id, series);
      stamped++;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillSeries, {
        cursor: page.continueCursor,
        pageSize,
      });
    }
    return { stamped, done: page.isDone };
  },
});
