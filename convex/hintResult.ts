import { v } from "convex/values";

/** What `coach.hints` answers with -- see HintResult in shared/sim/coach.ts. */
export const hintResult = v.object({
  turnNumber: v.number(),
  moves: v.array(
    v.object({
      placements: v.array(
        v.object({ x: v.number(), y: v.number(), letter: v.string(), isBlank: v.boolean() }),
      ),
      total: v.number(),
      words: v.array(
        v.object({
          word: v.string(),
          points: v.number(),
          rare: v.boolean(),
          multiplier: v.optional(v.number()),
          long: v.optional(v.boolean()),
        }),
      ),
      squares: v.number(),
      leavesOpen: v.number(),
    }),
  ),
  rackWords: v.array(v.string()),
});
