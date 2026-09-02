import { v } from "convex/values";
import ALL_WORDS from "../shared/data/words.json" with { type: "json" };
import { OPEN_BOARD, boardShapeNamed } from "../shared/boards.js";
import { type Difficulty } from "../shared/config.js";
import { makeBoard, type TileSpec } from "../shared/engine/board.js";
import { makeDictionary } from "../shared/engine/dictionary.js";
import { applyPlacements, wordsFormed, type Dictionary } from "../shared/engine/legality.js";
import { chooseRanked, indexWords, rank, type Move, type WordIndex } from "../shared/sim/bot.js";
import { scoreTurn } from "../shared/engine/score.js";
import { blanksLeft } from "./games.js";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * A computer player taking its turn.
 *
 * Scheduled rather than run inside the move that hands it the turn: the person
 * who just played should not wait on it, and a moment's pause reads as
 * thinking rather than as a machine answering instantly.
 *
 * An action rather than a mutation, because thinking is not a transaction. A
 * query or mutation is stopped at one second of user code and a stopped bot
 * turn does not come back slow, it fails — and nothing reschedules it, so the
 * game sticks on that seat for good. A Convex-runtime action is allowed thirty
 * minutes. The turn reads through `turnState`, thinks with no clock over it at
 * all, and writes through the same `games.playForBot` it always did, which is
 * still the one transaction in the whole affair.
 *
 * What that costs is atomicity: between the read and the write a person at the
 * table may play. See `ATTEMPTS`.
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
   * lengths were cut when a turn had a second to finish in, and that reason has
   * gone with the rest. It is another thing to measure rather than another
   * thing to keep. Crossing words are checked against the whole dictionary
   * above, so nothing the bot plays is limited to seven letters; only what it
   * looks for is.
   */
  words ??= indexWords(
    ALL_WORDS.filter((word) => word.length <= 7),
    7,
  );
  return { dictionary, words };
}

/**
 * Blanks the search may consider spending in one turn, out of the three a
 * player holds for the game. See the note at the call site.
 */
const BLANKS_PER_TURN = 1;

/**
 * A pause long enough to read as a turn being taken.
 *
 * Held *inside* the turn rather than in front of it. It used to be the delay
 * `scheduleIfBot` scheduled with, which meant thinking was added to it: a
 * 1,135ms turn behind a 1,600ms delay kept somebody waiting 2,735ms, and the
 * more the bot thought the worse it got. Now the turn starts at once and holds
 * until this much has passed since it began, so the thinking happens inside
 * the pause instead of after it and the wait is 1,600ms whatever the search
 * costs — until the search costs more than that, at which point the pause is
 * over and the move lands as soon as it is ready.
 *
 * This needs a clock that runs, which is the other thing the conversion
 * bought: `Date.now()` is frozen inside a mutation and advances inside an
 * action. Measured on this deployment — a spin loop saw 63ms, a 50ms sleep saw
 * 51ms.
 */
const THINKING_MS = 1_600;

/** Hold until the turn has taken as long as a turn should take. */
async function untilThoughtThrough(since: number) {
  const thought = Date.now() - since;
  const left = THINKING_MS - thought;
  if (left > 0) {
    await new Promise((resolve) => setTimeout(resolve, left));
    return;
  }

  /*
   * The search ran past the pause, so this is a turn somebody actually waited
   * on rather than one that hid inside it.
   *
   * Worth a line in the log, because it is the only signal a slow turn gives
   * any more. While the turn was a mutation, one that ran long failed and said
   * so; an action just takes longer and says nothing. This is what replaces
   * that, and it fires at the point a person starts noticing rather than at
   * the point the platform gives up.
   */
  console.warn(`bot turn thought for ${thought}ms, past the ${THINKING_MS}ms pause`);
}

/**
 * How many times a turn will read the board, think, and try to play it.
 *
 * The price of thinking outside a transaction. Between `turnState` and
 * `playForBot` a person at the table may play, and then the move this turn
 * settled on answers a board that no longer exists. `playForBot` validates
 * independently and refuses it, which arrives here as a thrown error.
 *
 * Reading again and thinking again is very nearly always the right answer —
 * the board has moved on by one play and the bot has a reply to it — but it
 * has to stop somewhere, or a table where somebody is playing quickly could
 * keep one bot turn re-thinking indefinitely. Three tries, then the seat
 * passes: a pass is a turn taken and the game goes on, where a turn that gives
 * up silently is the stuck seat this whole conversion exists to avoid.
 *
 * That pass is not free, and it is the reason to keep the number small rather
 * than large. A bot that had a legal move and passed anyway adds one to
 * `consecutivePasses`, and `playerCount * 2` of those in a row ends the game.
 * Three exhausted attempts is a bad turn; thirty would be a lost game.
 *
 * No overtaker is currently constructible. A bot's turn is only scheduled when
 * the bot is on the move, a person cannot play out of turn, and `resignGame`
 * goes through `finishGame`, so a resign leaves `turnState` returning null
 * rather than a board that has moved. The loop is insurance against write
 * paths that do not exist yet, and against a read that simply does not come
 * back — which is why it wraps the reads too.
 */
const ATTEMPTS = 3;

export const takeTurn = internalAction({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    /** The seat this turn is being taken for, kept for the pass below. */
    let userId: Id<"users"> | null = null;

    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      /*
       * The reads are inside the `try` with the write, and deliberately.
       *
       * `turnState` and the per-candidate `wordsMissing` are function calls
       * across the network now, where they used to be `ctx.db` reads that
       * could not fail on their own. A throw from either would fail the
       * action, and Convex does not retry a failed scheduled action -- so the
       * seat would never move again, which is the exact failure this whole
       * conversion exists to remove. A read that fails rounds the loop like a
       * write that fails, and what survives all three attempts falls through
       * to the pass below.
       */
      try {
        const state = await ctx.runQuery(internal.bots.turnState, {
          gameId: args.gameId,
        });
        // Not a bot's turn any more: a person may have quit, or the seat moved
        // on while this was waiting to run. Nothing to play, nothing to pass.
        if (state === null) return null;
        userId = state.userId;

        // Nothing playable. Trading is the only other move, and an empty bag
        // leaves passing — which advancing with no tiles amounts to.
        const placements = (await chooseMove(ctx, state)) ?? [];

        // The move is ready; the pause is not necessarily over. Waiting here
        // rather than before thinking is what keeps a slow turn from being a
        // slow turn *and* a long pause. On a second attempt this has already
        // elapsed and returns at once, which is right -- the person waiting
        // has been waiting since the first.
        await untilThoughtThrough(startedAt);

        await ctx.runMutation(internal.games.playForBot, {
          gameId: args.gameId,
          userId,
          placements,
        });
        return null;
      } catch (error) {
        // The board moved under the move, or a read did not come back. Round
        // the loop: the next read sees whatever overtook this, and the search
        // answers that board instead.
        console.warn(`bot turn ${attempt} of ${ATTEMPTS} refused`, error);
      }
    }

    // Out of attempts. Pass, so the seat moves on rather than stopping the
    // game here. `playForBot` checks the seat before recording a pass, so if
    // the turn has already gone elsewhere this writes nothing.
    if (userId === null) return null;
    try {
      await untilThoughtThrough(startedAt);
      await ctx.runMutation(internal.games.playForBot, {
        gameId: args.gameId,
        userId,
        placements: [],
      });
    } catch (error) {
      console.error("bot turn could not even pass", error);
    }
    return null;
  },
});

/**
 * Everything a turn is thought out from, read in one go.
 *
 * One round trip instead of three. In the mutation this replaced the reads
 * were free; from an action each one is a call across the network, and the
 * whole point of the move is to spend the budget on searching rather than on
 * bookkeeping. Reading them together also means the seat, the rack and the
 * board all come out of a single transaction, so what the search is handed is
 * at least consistent with itself — it can still be overtaken afterwards,
 * which is what `ATTEMPTS` is for.
 */
export const turnState = internalQuery({
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
    if (player === null || player.bot === undefined) return null;

    const tiles = await ctx.db
      .query("tiles")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .take(512);

    return {
      userId: player.userId,
      level: player.bot,
      letters: player.letters,
      blanks: blanksLeft(player),
      boardSize: game.boardSize,
      tiles: tiles.map((t) => ({
        x: t.x,
        y: t.y,
        letter: t.letter,
        isBlank: t.isBlank,
        stacked: t.stacked ?? 1,
      })),
    };
  },
});

type TurnState = {
  userId: Id<"users">;
  level: Difficulty;
  letters: string[];
  blanks: number;
  boardSize: number;
  tiles: TileSpec[];
};

/** The move a bot of this difficulty makes, or null if it cannot play. */
async function chooseMove(ctx: ActionCtx, state: TurnState) {
  const board = makeBoard(state.tiles);
  const shape = boardShapeNamed(OPEN_BOARD, state.boardSize);

  const { dictionary, words } = thinking();
  const moves = rank(
    board,
    /*
     * One blank a turn, out of an allowance of three.
     *
     * This was a deadline. It is now a measurement, and the measurement says
     * the same thing for a different reason: the search is told about one
     * blank because more than one buys nothing and is the only knob that
     * pushes a turn past the pause somebody is watching.
     *
     * Fourteen whole bot-against-bot games an allowance, everything else as it
     * ships. "Past the pause" counts turns whose thinking ran beyond the
     * 1,600ms THINKING_MS holds, which is to say turns a person waited on:
     *
     *   blanks 1: 346 turns,  492ms mean,  1103ms worst,   0/346 past the pause,
     *             2.71 3x3+/game, 356 pts/game
     *   blanks 2: 362 turns,  797ms mean,  3594ms worst,  39/362 past the pause,
     *             2.50 3x3+/game, 368 pts/game
     *   blanks 3: 336 turns, 1272ms mean,  5933ms worst, 110/336 past the pause,
     *             1.71 3x3+/game, 341 pts/game
     *
     * Two is a wash -- twelve points for a ninth of turns becoming a visible
     * wait of up to 3.6 seconds. Three is worse than one at everything: fewer
     * squares, fewer points, and a third of all turns spent in front of
     * somebody. `blankPrice` charges for a blank precisely so it is not spent
     * lightly, and handing the search more of them mostly buys blank-heavy
     * moves that crowd better ones out of the shortlist.
     *
     * Where the cost lives, since an earlier version of this comment got it
     * wrong and blamed the span search: **the live span search cannot spend a
     * blank at all.** `rank` computes `everywhere` from `blanksEverywhere`,
     * this call site does not set it, so `components` and `chain` are handed a
     * rack with `blanks: 0` and every driver inside them derives from that.
     * Proven rather than argued -- with `squares: { maxBlocks: 0 }`, which
     * switches the block pass and `blankMoves` off together, the opening move
     * returns *the same 2,888 moves in the same 32ms at blanks 0, 1 and 3*.
     * All of the blank cost is `blockMoves`: on an empty board a 2x2 is four
     * cells, each tried against the rack and all twenty-six, which at three
     * blanks is some 39,000 solutions, each then priced by `exposure` and
     * `blankPrice`.
     *
     * So `squares.nodeLimit` is the lever if that cost ever needs bounding.
     * Measured locally on the opening at three blanks: the default 20,000
     * costs 474ms, 2,000 costs 293ms, 500 costs 102ms. It is not set because
     * at one blank it does not bind -- 2,000 and 20,000 return the same 9,108
     * moves -- so it would buy nothing today and cost strength the moment it
     * did bind.
     */
    { letters: state.letters, blanks: Math.min(state.blanks, BLANKS_PER_TURN) },
    dictionary,
    words,
    shape,
    state.boardSize,
    /*
     * `before` comes from the search rather than being closed over. A turn may
     * now be several plays long, and each play is scored against the board it
     * actually lands on; the search pins `before` to the board the whole turn
     * started from, which is what stacking bonuses are measured against.
     */
    (after, placements, before) => scoreTurn(after, placements, { before }).total,
    /*
     * Two plays per turn, from four candidates a step -- not the six `rank`
     * defaults to. The block solver is back to the default `reletter: 2`.
     *
     * Re-lettering had been measured to buy *nothing*: the twelve blocks at
     * the front of the shortlist are the ones with the fewest gaps, which is
     * to say the most standing letters, and a rewrite budget of two cannot
     * rescue six standing letters that do not fit a word square -- zero extra
     * 3x3s over 208 turns. That measurement was taken before the live bot
     * spent a blank at all, and a blank is what makes a rewrite worth having:
     * it is twenty-six ways to take a branch on a standing tile, which is both
     * why re-lettering costs so much more with one in hand and why it now
     * closes squares it could not reach before.
     *
     * Measured here, fourteen whole bot-against-bot games an allowance, one
     * blank in hand throughout, everything else as it ships:
     *
     *   reletter 0: 374 turns, 316ms mean, 459ms p95, 700ms worst, 1.43 3x3+/game
     *   reletter 2: 346 turns, 492ms mean, 905ms p95, 1103ms worst, 2.71 3x3+/game
     *
     * Nearly double the squares for 176ms of mean thinking, and the thinking
     * is free: the pause is 1,600ms and holds the search inside it, so not one
     * turn in either run was something a person waited on. The old reason to
     * refuse this -- that 954ms was dangerously near a 1s deadline -- names a
     * deadline that no longer exists.
     */
    { chain: { depth: 2, breadth: 4 } },
  );

  /*
   * The table has the last word. The bundle is built from it, so this should
   * never turn a move down -- and if the two ever drift apart, the bot falls
   * through to the next move it would have picked rather than playing
   * something the game will refuse.
   */
  for (const move of inPreferredOrder(moves, state.level)) {
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
async function allWords(ctx: ActionCtx, words: readonly string[]) {
  const missing = await ctx.runQuery(internal.bots.wordsMissing, {
    words: [...new Set(words)],
  });
  return missing.length === 0;
}

/**
 * Which of these words the game's dictionary does not have.
 *
 * A whole move in one call, rather than a row read per word. Inside a
 * transaction the per-word reads were nearly free; from an action each would
 * be a round trip, and a chained turn forms more words than a single-span one
 * -- so checking them one at a time could easily have cost more than the
 * deadline this conversion removed. `chooseMove` calls this once per candidate
 * and stops at the first that comes back empty, which in practice is the first
 * candidate, because the bundle is built from this table.
 */
export const wordsMissing = internalQuery({
  args: { words: v.array(v.string()) },
  handler: async (ctx, args) => {
    const checked = await Promise.all(
      [...new Set(args.words)].map(async (word) => {
        const row = await ctx.db
          .query("words")
          .withIndex("by_word", (q) => q.eq("word", word))
          .unique();
        return row === null ? word : null;
      }),
    );
    return checked.filter((word): word is string => word !== null);
  },
});

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

    // At once, not after THINKING_MS: the turn holds the pause itself, so that
    // the time it spends thinking comes out of the pause rather than being
    // added to it. See THINKING_MS.
    await ctx.scheduler.runAfter(0, internal.bots.takeTurn, {
      gameId: args.gameId,
    });
    return null;
  },
});
