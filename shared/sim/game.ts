import { boardShapeNamed, OPEN_BOARD } from "../boards.js";
import { GAME, RACK } from "../config.js";
import { applyPlacements } from "../engine/legality.js";
import type { Dictionary } from "../engine/legality.js";
import { makeBoard } from "../engine/board.js";
import type { Board } from "../engine/board.js";
import { refill } from "../engine/rack.js";
import { newSquares } from "../engine/squares.js";
import { chooseRanked, rank, type Difficulty, type WordIndex } from "./bot.js";
import type { ValueFn } from "./components.js";
import { bagFlat, bagFromWeights, draw, tilesLeft, type Bag } from "./bag.js";
import { RARE, turnValue, type Variant } from "./variants.js";

export interface GameResult {
  /** Squares between the played mass and the nearest edge. */
  edgeMargin: number;
  scores: number[];
  turns: number;
  tilesPlaced: number;
  /** Turns where a player had nothing to play. */
  passes: number;
  /** Rare letters that reached the board. */
  rarePlayed: string[];
  /** Score of the single best turn anyone took. */
  bestTurn: number;
  /** Ended because the bag ran dry rather than on the tile threshold. */
  ranDry: boolean;
  /** Squares completed, by size. */
  squares: Record<number, number>;
}

interface Player {
  letters: string[];
  blanks: number;
  score: number;
}

function makeBag(variant: Variant): Bag | null {
  if (variant.bag === null) return null;
  if (variant.bag === 0) return bagFlat();
  const weights = variant.weights ?? RACK.weights;
  // Given exact contents, use them as they are: scaling a bag someone wrote
  // by hand would round the very ratios being tested.
  return variant.weights === undefined
    ? bagFromWeights(weights, variant.bag)
    : new Map(Object.entries(weights).filter(([, n]) => n > 0));
}

/** Top a hand back up, from the bag if there is one, otherwise out of the air. */
function topUp(player: Player, bag: Bag | null, rng: () => number) {
  if (bag === null) {
    player.letters = refill(player.letters, rng, RACK).letters;
    return;
  }
  player.letters.push(...draw(bag, RACK.size - player.letters.length, rng));
}

/**
 * Play one game out, bot against bot.
 *
 * `difficulties` seats the players: seat i plays at `difficulties[i %
 * difficulties.length]`, so one entry sets the whole table and two seat a hard
 * bot against an easy one. It defaults to `hard` rather than to the best move
 * available, which is the stronger player and not one anybody can be dealt.
 *
 * `rng` does double duty — tiles and move choice — deliberately. A game is
 * reproducible from its seed alone, and adding a second stream for the choice
 * would be a second thing to seed and a second thing to get wrong. It does
 * mean the draws a game sees depend on how many turns had a move to choose
 * among, so figures from before difficulty existed are not seed-comparable
 * with figures from after it; see docs/design.md §6.
 *
 * `chain` is the shape of the multi-play search: how many components a turn
 * may be built from, and how many candidates each step branches on. Left out,
 * `rank` picks its own default -- which is what every figure in design.md §6
 * was measured at, so passing nothing keeps a run comparable with that table.
 */
export function playGame(
  variant: Variant,
  players: number,
  dictionary: Dictionary,
  words: WordIndex,
  rng: () => number,
  difficulties: readonly Difficulty[] = ["hard"],
  chain?: { depth: number; breadth: number; enablement?: number },
): GameResult {
  const size = variant.size ?? GAME.boardSize;
  const shape = boardShapeNamed(OPEN_BOARD, size);
  const bag = makeBag(variant);

  let board: Board = makeBoard([]);

  const hands: Player[] = Array.from({ length: players }, () => {
    const player: Player = { letters: [], blanks: 3, score: 0 };
    topUp(player, bag, rng);
    return player;
  });

  const claimed = new Set<string>();
  const rarePlayed: string[] = [];
  const squares: Record<number, number> = {};
  let turns = 0;
  let passes = 0;
  let bestTurn = 0;
  let consecutivePasses = 0;
  /*
   * The last turn, once somebody has gone out: their turn plus one more for
   * everyone else, exactly as `advanceTurn` sets it in convex/games.ts. Turn
   * `turns - 1` is the one just played, since `turns` is incremented above.
   */
  let endsAfterTurn: number | null = null;

  /*
   * Reads `claimed` as it stands when a move is scored, not as it stood when
   * this was written: the set is mutated in place below, and a variant that
   * pays for a rare letter only the first time depends on that.
   */
  const scoreOf: ValueFn = (after, p, before) =>
    turnValue(after, p, variant, claimed, before).score;

  while (turns < 200) {
    const seat = turns % players;
    const player = hands[seat];

    /*
     * Ranked, then drawn from by difficulty — the same two steps convex/bots.ts
     * takes, and for the same reason. Taking `rank(...)[0]` instead, which is
     * what `bestMove` does and what this used to call, makes a player that is
     * perfect over its own ranking: stronger than `hard` and not a difficulty
     * anyone can be dealt, so the table it produced described nobody.
     */
    const moves = rank(
      board,
      { letters: player.letters, blanks: player.blanks },
      dictionary,
      words,
      shape,
      size,
      scoreOf,
      { chain },
    );
    const move = chooseRanked(moves, difficulties[seat % difficulties.length], rng);

    turns++;

    if (move === null) {
      passes++;
      consecutivePasses++;
      // Everyone stuck in a row: the game is going nowhere, as in the app.
      if (consecutivePasses >= players * 2) break;
      // A pass still spends a turn of the final round, as it does live.
      if (endsAfterTurn !== null && turns - 1 >= endsAfterTurn) break;
      continue;
    }
    consecutivePasses = 0;

    const boardBefore = board;
    board = applyPlacements(board, move.placements);

    // Scored against the board the move *makes*, with the board it started
    // from alongside it. Both matter: the after-board is where a word the move
    // extended is read in full, and the before-board is the only record of what
    // a stacked tile landed on. This used to pass the pre-move board as the
    // first argument and nothing as the last, and so got both halves wrong.
    const { score, doubled } = turnValue(board, move.placements, variant, claimed, boardBefore);
    for (const letter of doubled) claimed.add(letter);
    for (const p of move.placements) {
      if (!p.isBlank && RARE.includes(p.letter)) rarePlayed.push(p.letter);
    }

    // Squares are counted where they are scored, so the totals line up with
    // what a player would have seen.
    for (const k of newSquares(boardBefore, board, move.placements)) squares[k] = (squares[k] ?? 0) + 1;

    player.score += score;
    bestTurn = Math.max(bestTurn, score);

    // Spend the tiles the move used, then draw back up.
    for (const p of move.placements) {
      if (p.isBlank) {
        player.blanks--;
        continue;
      }
      const at = player.letters.indexOf(p.letter);
      if (at >= 0) player.letters.splice(at, 1);
    }
    topUp(player, bag, rng);

    /*
     * The game runs until the tiles run out: the bag empties, hands play out,
     * and it ends the moment somebody has nothing left. Measuring bag sizes
     * against a fixed tile count instead — which is what this did — made a
     * bigger bag look like it never emptied, when what really happened was
     * that the count stopped the game first.
     */
    if (bag === null) {
      if (board.size >= GAME.endThreshold) break;
    } else if (
      endsAfterTurn === null &&
      tilesLeft(bag) === 0 &&
      player.letters.length === 0 &&
      player.blanks === 0
    ) {
      // Out: the last round starts, and everyone still to move gets a turn.
      // Blanks count as tiles in hand -- see the note in convex/games.ts.
      endsAfterTurn = turns - 1 + players - 1;
    }

    if (endsAfterTurn !== null && turns - 1 >= endsAfterTurn) break;
  }

  let margin = size;
  for (const key of board.keys()) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    margin = Math.min(margin, x, y, size - 1 - x, size - 1 - y);
  }

  return {
    edgeMargin: margin,
    scores: hands.map((h) => h.score),
    turns,
    tilesPlaced: board.size,
    passes,
    rarePlayed,
    bestTurn,
    ranDry: bag !== null && tilesLeft(bag) === 0,
    squares,
  };
}
