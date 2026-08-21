import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { makeBoard } from "../engine/board";
import { makeDictionary } from "../engine/dictionary";
import { bestMove, indexWords } from "./bot";

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
