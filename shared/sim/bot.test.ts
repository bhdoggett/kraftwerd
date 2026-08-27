import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { makeBoard } from "../engine/board";
import { scoreTurn } from "../engine/score";
import { makeDictionary } from "../engine/dictionary";
import { bestMove, chooseRanked, indexWords, rank, type Move } from "./bot";

const WORDS = ["AT", "ATE", "EAT", "TEA", "CAT", "ACE", "TEN", "AN", "NET"];
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

  test("spends a blank when the rack cannot cover a word on its own", () => {
    const board = makeBoard([{ x: 7, y: 7, letter: "A", isBlank: false }]);
    const move = play(board, ["C"], 1);

    expect(move).not.toBeNull();
    expect(move!.placements.some((p) => p.isBlank)).toBe(true);
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
});

describe("choosing by difficulty", () => {
  const moves: Move[] = Array.from({ length: 20 }, (_, i) => ({
    placements: [],
    score: 100 - i,
  }));

  /** Where in the ranking each difficulty lands, over many draws. */
  const sample = (difficulty: Parameters<typeof chooseRanked>[1]) => {
    let seed = 7;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };

    const picks = Array.from({ length: 4000 }, () => {
      const chosen = chooseRanked(moves, difficulty, rng);
      return moves.indexOf(chosen!);
    });

    return {
      best: picks.filter((i) => i === 0).length / picks.length,
      mean: picks.reduce((sum, i) => sum + i, 0) / picks.length,
    };
  };

  test("hard takes its best move most of the time, but not always", () => {
    const { best } = sample("hard");

    expect(best).toBeGreaterThan(0.6);
    expect(best).toBeLessThan(0.85);
  });

  test("easy spreads its choice well down the list", () => {
    const easy = sample("easy");
    const hard = sample("hard");

    expect(easy.best).toBeLessThan(0.2);
    expect(easy.mean).toBeGreaterThan(hard.mean * 3);
  });

  test("medium sits between them", () => {
    const { mean } = sample("medium");

    expect(mean).toBeGreaterThan(sample("hard").mean);
    expect(mean).toBeLessThan(sample("easy").mean);
  });

  test("with one move on offer, every difficulty plays it", () => {
    const only = [{ placements: [], score: 5 }];

    for (const level of ["easy", "medium", "hard"] as const) {
      expect(chooseRanked(only, level, () => 0.99)).toBe(only[0]);
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
