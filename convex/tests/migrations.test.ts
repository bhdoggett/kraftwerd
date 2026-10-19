/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "!../**/*.test.ts"]);

/*
 * Rematches made before `seriesId` was recorded are linked only one step at
 * a time, through `rematchId` on the game before. The backfill stamps every
 * game after the first with the first game's id, the way a rematch made
 * today is stamped when it is made.
 */

/** Finished games, oldest first, each the rematch of the one before. */
async function chain(t: ReturnType<typeof convexTest>, length: number) {
  return t.run(async (ctx) => {
    const user = await ctx.db.insert("users", { authId: "auth|a", displayName: "A" });
    const ids: Id<"games">[] = [];
    for (let i = 0; i < length; i++) {
      ids.push(
        await ctx.db.insert("games", {
          layout: "Bars",
          status: "finished",
          boardSize: 15,
          endThreshold: 0,
          playerCount: 2,
          currentSeat: 0,
          turnNumber: 1,
          tileCount: 0,
          createdBy: user,
        }),
      );
    }
    for (let i = 0; i + 1 < length; i++) {
      await ctx.db.patch("games", ids[i], { rematchId: ids[i + 1] });
    }
    return ids;
  });
}

const seriesOf = (t: ReturnType<typeof convexTest>, ids: Id<"games">[]) =>
  t.run(async (ctx) =>
    Promise.all(ids.map(async (id) => (await ctx.db.get("games", id))?.seriesId ?? null)),
  );

/** Runs the backfill and every page it schedules after itself. */
async function backfill(t: ReturnType<typeof convexTest>, pageSize?: number) {
  vi.useFakeTimers();
  await t.mutation(internal.migrations.backfillSeries, { pageSize });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
}

test("every rematch in an old chain takes the first game's id", async () => {
  const t = convexTest(schema, modules);
  const [a, b, c, d] = await chain(t, 4);

  await backfill(t);

  expect(await seriesOf(t, [a, b, c, d])).toEqual([null, a, a, a]);
});

test("a chain that runs across pages comes out the same", async () => {
  const t = convexTest(schema, modules);
  const ids = await chain(t, 5);

  await backfill(t, 2);

  expect(await seriesOf(t, ids)).toEqual([null, ...ids.slice(1).map(() => ids[0])]);
});

test("a rematch made today from an old chain's middle joins the old chain", async () => {
  // A and B were linked before series existed. C was made from B today,
  // so it was stamped with B -- the first game it could see.
  const t = convexTest(schema, modules);
  const [a, b, c] = await chain(t, 3);
  await t.run(async (ctx) => {
    await ctx.db.patch("games", c, { seriesId: b });
  });

  // A page a game, so B's series is settled in an earlier page than C's.
  await backfill(t, 1);

  expect(await seriesOf(t, [a, b, c])).toEqual([null, a, a]);
});

test("running it again changes nothing", async () => {
  const t = convexTest(schema, modules);
  const ids = await chain(t, 3);
  await backfill(t);
  const once = await t.run(async (ctx) =>
    Promise.all(ids.map((id) => ctx.db.get("games", id))),
  );

  await backfill(t);

  const twice = await t.run(async (ctx) =>
    Promise.all(ids.map((id) => ctx.db.get("games", id))),
  );
  expect(twice.map((g: Doc<"games"> | null) => g?.seriesId)).toEqual(
    once.map((g: Doc<"games"> | null) => g?.seriesId),
  );
});
