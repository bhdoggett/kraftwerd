import { v } from "convex/values";
import ALL_WORDS from "../shared/data/words.json" with { type: "json" };
import { OPEN_BOARD, boardShapeNamed } from "../shared/boards.js";
import { type Difficulty } from "../shared/config.js";
import { makeBoard } from "../shared/engine/board.js";
import { makeDictionary } from "../shared/engine/dictionary.js";
import { applyPlacements, wordsFormed, type Dictionary } from "../shared/engine/legality.js";
import { chooseRanked, indexWords, rank, type Move, type WordIndex } from "../shared/sim/bot.js";
import { scoreTurn } from "../shared/engine/score.js";
import { blanksLeft } from "./games.js";
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
   * Only words up to seven letters are indexed, seven being the most tiles a
   * turn can lay: a rack holds seven. A longer word is not out of reach in
   * principle -- it would run through letters already standing -- but those
   * lengths cost more search than a one-second mutation can afford. Crossing
   * words are checked against the whole dictionary above.
   */
  words ??= indexWords(
    ALL_WORDS.filter((word) => word.length <= 7),
    7,
  );
  return { dictionary, words };
}

/**
 * Blanks the search may consider spending in one turn, out of the three a
 * player holds for the game. See the note at the call site: two does not fit
 * in a one-second mutation.
 */
const BLANKS_PER_TURN = 1;

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
     * One blank a turn, out of an allowance of three.
     *
     * The bot plays blanks at all now, which it did not; and it will not spend
     * two in one turn, which is a deadline and not a rule. A mutation is a
     * transaction and Convex stops one at a second, and a stopped turn is not
     * slow, it fails -- nothing reschedules it, so the game sticks on this seat
     * for good.
     *
     * Two things had to give before even one blank fitted.
     *
     * The first was the block solver. Seven letters and three blanks is ten
     * tiles and a 3x3 wants nine, so a hand holding blanks was the first that
     * could raise a square out of nothing: on the opening move `blockMoves`
     * shortlisted every 3x3 over the centre and ran a nine-deep solver on each
     * against a rack that was most of the alphabet. That turn timed out every
     * time it was tried, and clamping `squares` did not rescue it
     * (`{ maxK: 3, maxBlocks: 4 }` and `{ maxK: 2, maxBlocks: 12 }` both still
     * died). `candidateBlocks` now refuses a k >= 3 block with nothing standing
     * in it -- k = 2 untouched, so the 2x2 opening play still stands.
     *
     * The second was `reletter`, below.
     *
     * What is left after both is the ordinary span search, where a blank is
     * twenty-six letters against every span, and that is what fixes the count
     * at one. Measured in this deployment on the opening move, fifteen games an
     * allowance, reading `userExecutionTime` from `convex logs --jsonl` because
     * `Date.now()` is frozen inside a mutation:
     *
     *   blanks 0:  254ms mean, 337ms worst, no failures
     *   blanks 1:  425ms mean, 751ms worst, no failures
     *   blanks 2:  835ms mean, five of fifteen timed out
     *   blanks 3: 1002ms mean, fifteen of fifteen timed out
     *
     * Two is not a near miss, it is a third of turn one lost. So the search is
     * told about one blank, and the other two wait for later turns. A turn
     * spending two blanks at once was never much of a turn -- `blankPrice`
     * charges for them precisely so they are not spent lightly -- and the
     * alternative on offer was none at all.
     *
     * `squares.nodeLimit` is still there and still unused: the block pass is no
     * longer where the time goes, so bounding it would buy nothing.
     */
    { letters: player.letters, blanks: Math.min(blanksLeft(player), BLANKS_PER_TURN) },
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
     *
     * `reletter: 0` is the fill-only block solver, and the live bot takes it
     * where the simulator keeps the default of two. Re-lettering was measured
     * to buy nothing under the shipped `maxBlocks: 12`: the twelve blocks at
     * the front of the shortlist are the ones with the fewest gaps, which is to
     * say the most standing letters, and a rewrite budget of two cannot rescue
     * six standing letters that do not fit a word square -- zero extra 3x3s
     * over 208 turns. What it costs is not nothing, and with a blank in hand it
     * is a great deal more than the 3.8% it looked like without one. Measured
     * here over whole bot-against-bot games, one blank in hand throughout:
     *
     *   reletter 2: 156 turns, mean 367ms, p95 682ms, worst 954ms
     *   reletter 0: 149 turns, mean 282ms, p95 431ms, worst 654ms
     *
     * A rewrite is a branch the solver takes on a standing tile, and a blank is
     * twenty-six ways to take it. Zero for nothing is the trade, and it is what
     * puts a blank in the bot's hand at the cost the seven letters already had.
     */
    { chain: { depth: 2, breadth: 4 }, squares: { reletter: 0 } },
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
