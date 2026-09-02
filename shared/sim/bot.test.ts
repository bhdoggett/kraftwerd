import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { makeBoard } from "../engine/board";
import { applyPlacements } from "../engine/legality";
import { scoreTurn } from "../engine/score";
import { makeDictionary } from "../engine/dictionary";
import { bestMove, chooseRanked, indexWords, rank, type Move } from "./bot";

// TO is here so the 2x2 at (7,7) in the blank tests spells something both ways.
const WORDS = ["AT", "AS", "ATE", "EAT", "TEA", "CAT", "CATS", "ACE", "TEN", "AN", "NET", "TO"];
const dictionary = makeDictionary(WORDS);
const words = indexWords(WORDS, 7);
const shape = boardShapeNamed(OPEN_BOARD, 15);

const play = (board: ReturnType<typeof makeBoard>, letters: string[], blanks = 0) =>
  bestMove(board, { letters, blanks }, dictionary, words, shape, 15);

describe("the bot", () => {
  test("opens across the centre square", () => {
    const move = play(makeBoard([]), ["C", "A", "T"]);

    expect(move).not.toBeNull();
    expect(move!.placements.some((p) => p.x === 7 && p.y === 7)).toBe(true);
  });

  test("plays through a letter already on the board", () => {
    const board = makeBoard([{ x: 7, y: 7, letter: "A", isBlank: false }]);
    const move = play(board, ["C", "T"]);

    // CAT, using the A that is already there: two tiles for a three-letter word.
    expect(move!.placements).toHaveLength(2);
    expect(move!.placements.every((p) => !(p.x === 7 && p.y === 7))).toBe(true);
  });

  test("spends a blank on a square only when the square beats the price", () => {
    /*
     * One board, one hand, two reserves. The blank has something real to beat
     * and the tile play has something real to lose to, so the only thing
     * deciding between them is `blankPrice`.
     *
     * Three corners of a 2x2, gap at (8,8). The blank closes it as TO/TO: two
     * words and a 2x2, eight points. The E instead plays ATE along row 7 for
     * three, and leaves nothing one tile short.
     */
    const near = makeBoard([
      { x: 7, y: 7, letter: "A", isBlank: false },
      { x: 8, y: 7, letter: "T", isBlank: false },
      { x: 7, y: 8, letter: "T", isBlank: false },
    ]);
    const hand = { letters: ["E"], blanks: 1 };
    const play = (reserve: number) =>
      bestMove(near, hand, dictionary, words, shape, 15, { blanks: { reserve } })!;

    // Cheap blank: eight points for the square is worth more than holding it.
    const cheap = play(2);
    expect(cheap.placements.some((p) => p.isBlank)).toBe(true);
    expect(cheap.placements).toEqual([{ x: 8, y: 8, letter: "O", isBlank: true }]);

    // Dear blank: the same square is no longer worth it, so the tile wins --
    // and it is declining an offer, not failing to find one.
    const dear = play(8);
    expect(dear.placements.some((p) => p.isBlank)).toBe(false);
    expect(dear.placements).toEqual([{ x: 9, y: 7, letter: "E", isBlank: false }]);
    expect(dear.score).toBeLessThan(cheap.score);
  });

  test("the general search leaves blanks alone unless it is asked", () => {
    // CAT off a lone A, with the blank standing in for the T. The old rule
    // played this the moment the rack alone could not; now a blank in the
    // general search would make every word of a length a candidate for every
    // span of it, so the move is simply not offered.
    const board = makeBoard([{ x: 7, y: 7, letter: "A", isBlank: false }]);
    const hand = { letters: ["C"], blanks: 1 };

    expect(bestMove(board, hand, dictionary, words, shape, 15)).toBeNull();

    const wide = bestMove(board, hand, dictionary, words, shape, 15,
      { blanksEverywhere: true });
    expect(wide!.placements.some((p) => p.isBlank)).toBe(true);
  });

  test("a blank is never spent when the option refuses it", () => {
    const near = makeBoard([
      { x: 7, y: 7, letter: "A", isBlank: false },
      { x: 8, y: 7, letter: "T", isBlank: false },
      { x: 7, y: 8, letter: "T", isBlank: false },
    ]);

    // The refusal is a refusal, not an infinite price: an infinity against a
    // move that spends no blank would be NaN, and NaN sorts nowhere.
    const refused = rank(near, { letters: [], blanks: 1 }, dictionary, words, shape, 15,
      (after, p, before) => scoreTurn(after, p, { before }).total, { blanks: false });
    expect(refused).toHaveLength(0);

    const open = rank(makeBoard([]), { letters: ["C", "A", "T"], blanks: 1 }, dictionary,
      words, shape, 15, (after, p, before) => scoreTurn(after, p, { before }).total,
      { blanks: false });
    expect(open.length).toBeGreaterThan(0);
    for (const move of open) expect(Number.isNaN(move.value)).toBe(false);
  });

  test("passes when nothing can be played", () => {
    const board = makeBoard([{ x: 7, y: 7, letter: "A", isBlank: false }]);
    expect(play(board, ["Q", "Z"])).toBeNull();
  });

  test("takes the higher-scoring of two legal plays", () => {
    const move = play(makeBoard([]), ["C", "A", "T", "E"]);

    // Longer words score more here, so a four-tile play beats a two-tile one.
    expect(move!.placements.length).toBeGreaterThan(2);
  });

  test("reports what a move scores separately from what it is worth", () => {
    const ranked = (options: Parameters<typeof rank>[7]) =>
      rank(
        makeBoard([]),
        { letters: ["C", "A", "T"], blanks: 0 },
        dictionary,
        words,
        shape,
        15,
        (b, p) => scoreTurn(b, p).total,
        options,
      );

    const greedy = ranked({ exposure: false });
    expect(greedy.length).toBeGreaterThan(0);
    // Judgement off, the two agree, and both are real points.
    for (const move of greedy) {
      expect(move.value).toBe(move.score);
      expect(move.score).toBeGreaterThan(0);
    }

    // Judgement on, only the opinion moves: every one of these opening plays
    // leaves an extendable word behind, so all of them are worth less than
    // they score, and not one of them scores differently for it.
    const judged = ranked({});
    const scores = (moves: Move[]) =>
      new Map(moves.map((m) => [JSON.stringify(m.placements), m.score]));
    expect(scores(judged)).toEqual(scores(greedy));
    for (const move of judged) expect(move.value).toBeLessThan(move.score);
  });

  test("lookahead lowers a move's value without touching its score", () => {
    const board = makeBoard([..."CAT"].map((letter, i) => ({
      x: 6 + i, y: 7, letter, isBlank: false, stacked: 1,
    })));

    const plain = rank(board, { letters: ["E"], blanks: 0 }, dictionary, words,
      shape, 15, (b, p) => scoreTurn(b, p, { before: board }).total, {});
    const wary = rank(board, { letters: ["E"], blanks: 0 }, dictionary, words,
      shape, 15, (b, p) => scoreTurn(b, p, { before: board }).total,
      { lookahead: { rack: ["A", "E", "T"], weight: 1 } });

    // Same move, same points; only the opinion of it moves.
    const key = (m: Move) => JSON.stringify(m.placements);
    const top = wary[0];
    const before = plain.find((m) => key(m) === key(top))!;
    expect(top.score).toBe(before.score);
    expect(top.value).toBeLessThanOrEqual(before.value);
  });

  test("scores a move against the board its tiles are on", () => {
    const board = makeBoard([..."CAT"].map((letter, i) => ({
      x: 6 + i, y: 7, letter, isBlank: false, stacked: 1,
    })));

    const moves = rank(board, { letters: ["S"], blanks: 0 }, dictionary, words,
      shape, 15, (after, p, before) => scoreTurn(after, p, { before }).total, {});

    // Every move must report what a fresh scoring of the same placements gives.
    // The search used to score against the board *before* the move, so a tile
    // forming a crossing word scored as a lone letter.
    for (const move of moves) {
      const after = applyPlacements(board, move.placements);
      expect(move.score).toBe(scoreTurn(after, move.placements, { before: board }).total);
    }
  });
});

describe("choosing by difficulty", () => {
  // A realistic spread: 100 down to 5. Bands land cleanly —
  // hard [85,100] = indices 0-3, medium [55,85] = 3-9, easy [30,55] = 9-14.
  const moves: Move[] = Array.from({ length: 20 }, (_, i) => ({
    placements: [],
    score: 100 - i * 5,
    value: 100 - i * 5,
  }));

  const sample = (difficulty: Parameters<typeof chooseRanked>[1], list = moves) => {
    let seed = 7;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };

    const picks = Array.from({ length: 4000 }, () => chooseRanked(list, difficulty, rng)!);
    const best = list[0].value;
    return {
      meanFraction: picks.reduce((sum, m) => sum + m.value / best, 0) / picks.length,
      lowestFraction: Math.min(...picks.map((m) => m.value / best)),
      highestFraction: Math.max(...picks.map((m) => m.value / best)),
    };
  };

  test("hard gives up little of what is on offer", () => {
    const { lowestFraction, meanFraction } = sample("hard");

    expect(lowestFraction).toBeGreaterThanOrEqual(0.85);
    expect(meanFraction).toBeGreaterThan(0.9);
  });

  test("easy plays well below the best available", () => {
    const { lowestFraction, highestFraction } = sample("easy");

    expect(highestFraction).toBeLessThanOrEqual(0.55);
    expect(lowestFraction).toBeGreaterThanOrEqual(0.3);
  });

  test("medium sits between them", () => {
    expect(sample("medium").meanFraction).toBeLessThan(sample("hard").meanFraction);
    expect(sample("medium").meanFraction).toBeGreaterThan(sample("easy").meanFraction);
  });

  test("with one move on offer, every difficulty plays it", () => {
    const only = [{ placements: [], score: 5, value: 5 }];

    for (const level of ["easy", "medium", "hard"] as const) {
      expect(chooseRanked(only, level, () => 0.99)).toBe(only[0]);
    }
  });

  test("an empty band widens upward rather than failing to play", () => {
    // Everything is close to the best, so easy's [0.30, 0.55] catches nothing.
    const tight: Move[] = Array.from({ length: 5 }, (_, i) => ({
      placements: [],
      score: 100 - i,
      value: 100 - i,
    }));

    const chosen = chooseRanked(tight, "easy", () => 0.99);
    // The nearest move above the band: the weakest on offer, never null.
    expect(chosen).toBe(tight[4]);
  });

  test("falls back to rank position when nothing scores above zero", () => {
    const bleak: Move[] = Array.from({ length: 10 }, (_, i) => ({
      placements: [],
      score: 5,
      value: -i,
    }));

    // Fractions of a negative best invert the ordering, so position decides.
    // Hard takes from the top of the list; easy from further down.
    expect(bleak.indexOf(chooseRanked(bleak, "hard", () => 0.01)!)).toBeLessThan(3);
    expect(bleak.indexOf(chooseRanked(bleak, "easy", () => 0.01)!)).toBeGreaterThan(3);
  });

  test("never returns null for a non-empty list", () => {
    for (const level of ["easy", "medium", "hard"] as const) {
      expect(chooseRanked(moves, level, () => 0.999)).not.toBeNull();
      expect(chooseRanked(moves, level, () => 0)).not.toBeNull();
    }
  });
});

describe("playing over what is already there", () => {
  const shape = boardShapeNamed(OPEN_BOARD, 15);
  const dictionary = makeDictionary(["CATS", "COTS", "COT", "CAT", "AT", "TO", "OT"]);
  const words = indexWords(["CATS", "COTS", "COT", "CAT", "AT", "TO"], 7);

  /** CATS across the middle, with nothing else to build on. */
  const board = makeBoard(
    [..."CATS"].map((letter, i) => ({
      x: 6 + i,
      y: 7,
      letter,
      isBlank: false,
      stacked: 1,
    })),
  );

  test("covers a letter to make a different word", () => {
    const moves = rank(
      board,
      { letters: ["O"], blanks: 0 },
      dictionary,
      words,
      shape,
      15,
      (b, p) => scoreTurn(b, p, { before: board }).total,
      {},
    );

    // CATS becomes COTS: one tile, laid on the A. Without this the bot can
    // only ever play into empty squares, so it never takes a square, never
    // earns a stacking bonus, and never covers a letter to open a block up.
    const covering = moves.filter((m) =>
      m.placements.some((p) => p.x === 7 && p.y === 7),
    );
    expect(covering.length).toBeGreaterThan(0);
    expect(covering[0]!.placements).toEqual([
      { x: 7, y: 7, letter: "O", isBlank: false },
    ]);
  });
});
