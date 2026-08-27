import { v } from "convex/values";
import ALL_WORDS from "../shared/data/words.json" with { type: "json" };
import { OPEN_BOARD, boardShapeNamed } from "../shared/boards.js";
import { type Difficulty } from "../shared/config.js";
import { makeBoard } from "../shared/engine/board.js";
import { makeDictionary } from "../shared/engine/dictionary.js";
import { applyPlacements, wordsFormed } from "../shared/engine/legality.js";
import { chooseRanked, indexWords, rank, type Move } from "../shared/sim/bot.js";
import { scoreTurn } from "../shared/engine/score.js";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

/**
 * A computer player taking its turn.
 *
 * Scheduled rather than run inside the move that hands it the turn: the person
 * who just played should not wait on it, and a moment's pause reads as
 * thinking rather than as a machine answering instantly.
 *
 * The dictionary rides along in the bundle, because a bot cannot read seventy
 * thousand rows on its turn: every move it weighs makes crossing words as well
 * as its own, and those have to be checked while the move is being considered
 * rather than after one has been settled on. The words table stays the
 * authority — what the bot finally plays is checked against it like anybody
 * else's move — but the bundle is what lets it tell a move from a mess.
 */
const DICTIONARY = makeDictionary(ALL_WORDS);

/**
 * The words it can lay, indexed by the letters they need.
 *
 * Only up to seven: a rack holds eight, and a word that long is beyond both
 * what the rack can spell and what the search can afford. Crossing words are
 * checked against the whole dictionary above, not this.
 */
const WORDS = indexWords(
  ALL_WORDS.filter((word) => word.length <= 7),
  7,
);

/** A pause long enough to read as a turn being taken. */
const THINKING_MS = 1_600;

export const takeTurn = internalMutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const game = await ctx.db.get("games", args.gameId);
    if (game === null || game.status !== "active") return null;

    const player = await ctx.db
      .query("players")
      .withIndex("by_game_and_seat", (q) =>
        q.eq("gameId", args.gameId).eq("seat", game.currentSeat),
      )
      .unique();
    // Not a bot's turn any more: a person may have quit, or the seat moved on
    // while this was waiting to run.
    if (player === null || player.bot === undefined) return null;

    const move = await chooseMove(ctx, game, player, player.bot);
    if (move === null) {
      // Nothing playable. Trading is the only other move, and an empty bag
      // leaves passing — which advancing with no tiles amounts to.
      await ctx.runMutation(internal.games.playForBot, {
        gameId: args.gameId,
        userId: player.userId,
        placements: [],
      });
      return null;
    }

    await ctx.runMutation(internal.games.playForBot, {
      gameId: args.gameId,
      userId: player.userId,
      placements: move,
    });
    return null;
  },
});

/** The move a bot of this difficulty makes, or null if it cannot play. */
async function chooseMove(
  ctx: MutationCtx,
  game: Doc<"games">,
  player: Doc<"players">,
  level: Difficulty,
) {
  const tiles = await ctx.db
    .query("tiles")
    .withIndex("by_game", (q) => q.eq("gameId", game._id))
    .take(512);

  const board = makeBoard(
    tiles.map((t) => ({
      x: t.x,
      y: t.y,
      letter: t.letter,
      isBlank: t.isBlank,
      stacked: t.stacked ?? 1,
    })),
  );

  const shape = boardShapeNamed(OPEN_BOARD, game.boardSize);

  const moves = rank(
    board,
    { letters: player.letters, blanks: 0 },
    DICTIONARY,
    WORDS,
    shape,
    game.boardSize,
    (b, p) => scoreTurn(b, p, { before: board }).total,
    {},
  );

  /*
   * The table has the last word. The bundle is built from it, so this should
   * never turn a move down -- and if the two ever drift apart, the bot falls
   * through to the next move it would have picked rather than playing
   * something the game will refuse.
   */
  for (const move of inPreferredOrder(moves, level)) {
    const after = applyPlacements(board, move.placements);
    const words = wordsFormed(after, move.placements);
    if (await allWords(ctx, words)) return move.placements;
  }
  return null;
}

/**
 * The ranked moves, in the order this difficulty would try them.
 *
 * Drawn without replacement, so a move the dictionary turns down falls through
 * to the next one this difficulty would have chosen — not to the best on
 * offer, which would make a rejected word into a free upgrade.
 */
function inPreferredOrder(moves: readonly Move[], level: Difficulty): Move[] {
  const left = [...moves];
  const out: Move[] = [];

  while (left.length > 0 && out.length < 12) {
    const chosen = chooseRanked(left, level, Math.random);
    if (chosen === null) break;
    out.push(chosen);
    left.splice(left.indexOf(chosen), 1);
  }
  return out;
}

/** Whether every word this move makes is in the game's dictionary. */
async function allWords(ctx: MutationCtx, words: readonly string[]) {
  for (const word of new Set(words)) {
    const found = await ctx.db
      .query("words")
      .withIndex("by_word", (q) => q.eq("word", word))
      .unique();
    if (found === null) return false;
  }
  return true;
}

/** Wake the seat that is on the move, if a machine holds it. */
export const scheduleIfBot = internalMutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const game = await ctx.db.get("games", args.gameId);
    if (game === null || game.status !== "active") return null;

    const player = await ctx.db
      .query("players")
      .withIndex("by_game_and_seat", (q) =>
        q.eq("gameId", args.gameId).eq("seat", game.currentSeat),
      )
      .unique();
    if (player?.bot === undefined) return null;

    await ctx.scheduler.runAfter(THINKING_MS, internal.bots.takeTurn, {
      gameId: args.gameId,
    });
    return null;
  },
});
