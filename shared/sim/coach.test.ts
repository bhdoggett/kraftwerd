import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { makeBoard } from "../engine/board";
import { makeDictionary } from "../engine/dictionary";
import { choose, coach, explain, rackWordsOf, MAX_HINTS } from "./coach";
import { indexWords } from "./words";

const lex = (words: string[]) => ({ dictionary: makeDictionary(words), words: indexWords(words, 7) });
const FULL = lex(["CAT", "ACT", "CATS", "ACTS", "SCAT", "AT", "TA", "AS", "SAT", "TAS"]);
const COMMON = lex(["CAT", "ACT", "CATS", "ACTS", "AT", "AS", "SAT"]);
const shape = boardShapeNamed(OPEN_BOARD, 15);
const BAG = { left: 85, start: 85 };
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
  test("at most four moves, each made from the rack and every word in the full list", () => {
    const rack = ["C", "A", "T", "S"];
    const { moves } = coach(makeBoard([]), { letters: rack, blanks: 0 }, FULL, COMMON, shape, 15, BAG);

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

  test("a blank can stand in for a letter in an ordinary word", () => {
    // No T in the rack: NUT needs the blank as its T.
    const { moves } = coach(makeBoard([]), { letters: ["N", "U"], blanks: 2 }, lex(["NUT"]), lex(["NUT"]), shape, 15, BAG);
    const nut = moves.find((m) => m.words.some((w) => w.word === "NUT"));
    expect(nut?.placements.filter((p) => p.isBlank)).toHaveLength(1);
  });

  test("no play is no moves, not an error", () => {
    const { moves } = coach(makeBoard([]), { letters: ["Q"], blanks: 0 }, FULL, COMMON, shape, 15, BAG);
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
      BAG,
    );
    expect(result.moves[0]?.words.map((w) => w.word)).toContain("LABORS");
  }, 60_000);
});


describe("choosing hints", () => {
  // A stand-in for a ranked move: a name that is its idea, and its blanks.
  const move = (name: string, blanks: number, idea = name) => ({
    name,
    idea,
    placements: Array.from({ length: 4 }, (_, i) => at(i, 7, "A", i < blanks)),
  });
  const pick = (ranked: ReturnType<typeof move>[], max?: number) =>
    choose(ranked, (m) => m.idea, max).map((m) => m.name);

  test("the best play spending no blanks always makes the list, however far down it ranks", () => {
    const ranked = [move("three", 3), move("two", 2), move("one", 1), move("one more", 1), move("plain", 0)];
    expect(pick(ranked, 4)).toEqual(["three", "two", "one", "plain"]);
  });

  test("otherwise the ranking alone decides, blanks or not", () => {
    const ranked = [move("one", 1), move("one more", 1), move("plain", 0), move("two", 2)];
    expect(pick(ranked, 3)).toEqual(["one", "one more", "plain"]);
  });

  test("with no plain play on offer, the blank plays are all there is", () => {
    expect(pick([move("one", 1), move("two", 2)], 4)).toEqual(["one", "two"]);
  });

  test("one idea is listed once, at its best", () => {
    const ranked = [move("YA+ALPINES", 1, "ALPINES"), move("AY+ALPINES", 1, "ALPINES"), move("plain", 0)];
    expect(pick(ranked)).toEqual(["YA+ALPINES", "plain"]);
  });

  test("the list keeps the ranking's order", () => {
    expect(pick([move("plain", 0), move("one", 1), move("plain too", 0)])).toEqual(["plain", "one", "plain too"]);
  });
});

describe("a hint's idea is its main word", () => {
  test("the same word slid along the board is one hint", () => {
    const words = ["CAT", "AT"];
    const { moves } = coach(makeBoard([]), { letters: ["C", "A", "T"], blanks: 0 }, lex(words), lex(words), shape, 15, BAG);
    const cats = moves.filter((m) => m.words.some((w) => w.word === "CAT"));
    expect(cats).toHaveLength(1);
  });
});
