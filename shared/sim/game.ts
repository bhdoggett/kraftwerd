import { boardShapeNamed, OPEN_BOARD } from "../boards.js";
import { GAME, RACK } from "../config.js";
import { applyPlacements } from "../engine/legality.js";
import type { Dictionary } from "../engine/legality.js";
import { makeBoard } from "../engine/board.js";
import type { Board } from "../engine/board.js";
import { refill } from "../engine/rack.js";
import { newSquares } from "../engine/squares.js";
import { bestMove, type WordIndex } from "./bot.js";
import { bagFlat, bagFromWeights, draw, tilesLeft, type Bag } from "./bag.js";
import { premiumsClaimed, RARE, turnValue, type Variant } from "./variants.js";

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
  return variant.bag === 0 ? bagFlat() : bagFromWeights(RACK.weights, variant.bag);
}

/** Top a hand back up, from the bag if there is one, otherwise out of the air. */
function topUp(player: Player, bag: Bag | null, rng: () => number) {
  if (bag === null) {
    player.letters = refill(player.letters, rng, RACK).letters;
    return;
  }
  player.letters.push(...draw(bag, RACK.size - player.letters.length, rng));
}

export function playGame(
  variant: Variant,
  players: number,
  dictionary: Dictionary,
  words: WordIndex,
  rng: () => number,
): GameResult {
  const size = variant.size ?? GAME.boardSize;
  const shape = boardShapeNamed(OPEN_BOARD, size);
  const bag = makeBag(variant);

  let board: Board = makeBoard([]);
  /** Premium squares already collected, so each pays once. */
  const premiumTaken = new Set<string>();

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

  while (turns < 200) {
    const player = hands[turns % players]!;
    const move = bestMove(
      board,
      { letters: player.letters, blanks: player.blanks },
      dictionary,
      words,
      shape,
      size,
      {
        value: (b, p) => turnValue(b, p, variant, claimed, size, premiumTaken).score,
      },
    );

    turns++;

    if (move === null) {
      passes++;
      consecutivePasses++;
      // Everyone stuck in a row: the game is going nowhere, as in the app.
      if (consecutivePasses >= players * 2) break;
      continue;
    }
    consecutivePasses = 0;

    const { score, doubled } = turnValue(
      board,
      move.placements,
      variant,
      claimed,
      size,
      premiumTaken,
    );
    for (const cell of premiumsClaimed(move.placements, size, premiumTaken)) {
      premiumTaken.add(cell);
    }
    for (const letter of doubled) claimed.add(letter);
    for (const p of move.placements) {
      if (!p.isBlank && RARE.includes(p.letter)) rarePlayed.push(p.letter);
    }

    const boardBefore = board;
    board = applyPlacements(board, move.placements);

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
    } else if (tilesLeft(bag) === 0 && player.letters.length === 0) {
      break;
    }
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
