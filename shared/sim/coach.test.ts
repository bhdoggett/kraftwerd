import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { makeBoard } from "../engine/board";
import { makeDictionary } from "../engine/dictionary";
import { coach, explain, rackWordsOf, MAX_HINTS } from "./coach";
import { indexWords } from "./words";

const lex = (words: string[]) => ({ dictionary: makeDictionary(words), words: indexWords(words, 7) });
const FULL = lex(["CAT", "ACT", "CATS", "ACTS", "SCAT", "AT", "TA", "AS", "SAT", "TAS"]);
const COMMON = lex(["CAT", "ACT", "CATS", "ACTS", "AT", "AS", "SAT"]);
const shape = boardShapeNamed(OPEN_BOARD, 15);
const at = (x: number, y: number, letter: string, isBlank = false) => ({ x, y, letter, isBlank });

describe("rack words", () => {
  test("three letters and up, longest first, then alphabetical, common only", () => {
    expect(rackWordsOf(["C", "A", "T", "S"], COMMON)).toEqual(["ACTS", "CATS", "ACT", "CAT", "SAT"]);
  });

  test("blanks are not letters", () => {
    expect(rackWordsOf(["C", "A"], COMMON)).toEqual([]);
  });
});

describe("explaining a move", () => {
  test("an opening across the centre is doubled, and says so", () => {
    const move = explain(makeBoard([]), [at(6, 7, "C"), at(7, 7, "A"), at(8, 7, "T")], COMMON, shape, 15);
    expect(move.total).toBe(6);
    expect(move.words).toEqual([{ word: "CAT", points: 6, rare: false, multiplier: 2 }]);
    expect(move.squares).toBe(0);
    expect(move.leavesOpen).toBe(0);
  });

  test("a word missing from the common list is rare", () => {
    const move = explain(makeBoard([]), [at(6, 7, "T"), at(7, 7, "A"), at(8, 7, "S")], COMMON, shape, 15);
    expect(move.words[0]).toMatchObject({ word: "TAS", rare: true });
  });
});

describe("coaching", () => {
  test("at most three moves, each made from the rack and every word in the full list", () => {
    const rack = ["C", "A", "T", "S"];
    const { moves } = coach(makeBoard([]), { letters: rack, blanks: 0 }, FULL, COMMON, shape, 15);

    expect(moves.length).toBeGreaterThan(0);
    expect(moves.length).toBeLessThanOrEqual(MAX_HINTS);
    for (const move of moves) {
      const left = [...rack];
      for (const p of move.placements) {
        const i = left.indexOf(p.letter);
        expect(i).toBeGreaterThanOrEqual(0);
        left.splice(i, 1);
      }
      for (const w of move.words) expect(FULL.dictionary.has(w.word)).toBe(true);
    }
  });

  test("no play is no moves, not an error", () => {
    const { moves } = coach(makeBoard([]), { letters: ["Q"], blanks: 0 }, FULL, COMMON, shape, 15);
    expect(moves).toEqual([]);
  });
});

describe("hints rank by what scores, not by what a bot would risk", () => {
  test("an opening long word beats a tight little square", () => {
    // A 2x2 in the centre is four doubled two-letter words; LABORS across the
    // centre is one doubled six-letter word and the long-word bonus. The bot's
    // defence used to rank the square first for what LABORS leaves open.
    const words = ["LABORS", "LABOR", "LA", "AB", "BO", "OR", "AR", "LO", "AS", "OS", "SO"];
    const result = coach(
      makeBoard([]),
      { letters: ["L", "A", "B", "O", "R", "S"], blanks: 0 },
      lex(words),
      lex(words),
      shape,
      15,
    );
    expect(result.moves[0]?.words.map((w) => w.word)).toContain("LABORS");
  }, 60_000);
});

