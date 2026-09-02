import { v } from "convex/values";
import ALL_WORDS from "../shared/data/words.json" with { type: "json" };
import { OPEN_BOARD, boardShapeNamed } from "../shared/boards.js";
import { type Difficulty } from "../shared/config.js";
import { makeBoard } from "../shared/engine/board.js";
import { makeDictionary } from "../shared/engine/dictionary.js";
import { applyPlacements, wordsFormed, type Dictionary } from "../shared/engine/legality.js";
import { chooseRanked, indexWords, rank, type Move, type WordIndex } from "../shared/sim/bot.js";
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
let dictionary: Dictionary | undefined;
let words: WordIndex | undefined;

/**
 * Built on the first bot turn, not when the module loads.
 *
 * Every function in a deployment shares the module graph, so work done at the
 * top level here is work the sign-in query pays for too — on every cold
 * isolate, in a game with no machines in it at all. Indexing the dictionary
 * is a bot's cost and should be charged to bots.
 */
function thinking() {
  dictionary ??= makeDictionary(ALL_WORDS);
  /*
   * Only up to seven letters may be laid: a rack holds eight, and a word that
   * long is beyond both what the rack can spell and what the search can
   * afford. Crossing words are checked against the whole dictionary above.
   */
  words ??= indexWords(
    ALL_WORDS.filter((word) => word.length <= 7),
    7,
  );
  return { dictionary, words };
}

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

  const { dictionary, words } = thinking();
  const moves = rank(
    board,
    /*
     * No blanks, and not for want of a place to keep them: `players.blanks`
     * carries the allowance and `games.ts` spends it correctly. It is a time
     * budget.
     *
     * A mutation is a transaction, and Convex stops one at a second. Seven
     * letters and three blanks is ten tiles, and a 3x3 wants nine -- so a hand
     * holding blanks is the first that can fill one from nothing, and on the
     * opening move `blockMoves` duly shortlists every 3x3 over the centre and
     * runs the solver on each. Measured in this deployment, that turn does not
     * finish: `bots:takeTurn` failed with "Function execution timed out
     * (maximum duration: 1s)" on an empty board, every time it was tried.
     * Nothing reschedules a failed turn, so the game would simply stop.
     *
     * Clamping `squares` does not rescue it -- `{ maxK: 3, maxBlocks: 4 }` and
     * `{ maxK: 2, maxBlocks: 12 }` both still timed out -- and what would is a
     * node budget on the solver, or a shortlist that refuses a block with
     * nothing standing in it yet. That belongs in `blocks.ts`, not here. Until
     * then the live bot plays its letters. The simulator still plays blanks,
     * so its numbers are a ceiling rather than what a person meets.
     */
    { letters: player.letters, blanks: 0 },
    dictionary,
    words,
    shape,
    game.boardSize,
    /*
     * `before` comes from the search rather than being closed over. A turn may
     * now be several plays long, and each play is scored against the board it
     * actually lands on; the search pins `before` to the board the whole turn
     * started from, which is what stacking bonuses are measured against.
     */
    (after, placements, before) => scoreTurn(after, placements, { before }).total,
    /*
     * Two plays per turn, from four candidates a step -- not the six `rank`
     * defaults to.
     *
     * The simulator keeps the default: it has cores to spend and is measuring
     * the strongest player. Here the budget is that same one-second
     * transaction, and it was measured in this deployment over whole bot-
     * against-bot games, reading the platform's own execution times ---
     * `Date.now()` is frozen inside a mutation and cannot time anything.
     *
     *   depth 1, breadth 6:  38 turns, mean 201ms, worst 274ms
     *   depth 2, breadth 6:  69 turns, mean 321ms, worst 902ms
     *   depth 2, breadth 4: 117 turns, mean 283ms, worst 596ms
     *
     * Latency is not what rules breadth 6 out -- THINKING_MS is 1600 and hides
     * any of these. The deadline is. A turn that overruns does not come back
     * slow, it fails, and nothing reschedules it, so the game stops on the
     * bot's move; and one worst turn in seventy at 902ms is close enough to a
     * second to expect that eventually. Breadth 4 keeps the chaining and puts
     * the worst turn seen at about three fifths of the budget. What it costs in
     * strength against breadth 6 was not measured -- the simulator is where
     * that question belongs, and it still runs the default.
     */
    { chain: { depth: 2, breadth: 4 } },
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
