import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { makeBoard, type Board } from "../engine/board";
import { makeDictionary } from "../engine/dictionary";
import { scoreTurn } from "../engine/score";
import { validateTurn } from "../engine/legality";
import { indexWords } from "./words";
import { anchors, components, moveKey } from "./components";

const WORDS = ["AT", "ATE", "EAT", "TEA", "CAT", "CATS", "COT", "COTS", "ACE",
  "TEN", "AN", "NET", "TO", "ON", "NO", "SO", "OAT", "OATS", "SAT", "SEA"];
const dictionary = makeDictionary(WORDS);
const words = indexWords(WORDS, 7);
const shape = boardShapeNamed(OPEN_BOARD, 15);

const find = (board: Board, letters: string[], blanks = 0) =>
  components(board, { letters, blanks }, dictionary, words, shape, 15,
    (b, p) => scoreTurn(b, p, { before: board }).total, {});

describe("anchors", () => {
  test("an empty board offers only the centre", () => {
    expect([...anchors(makeBoard([]), shape, 15)]).toEqual(["7,7"]);
  });

  test("a played tile offers itself and its four neighbours", () => {
    const live = anchors(makeBoard([{ x: 7, y: 7, letter: "A", isBlank: false }]), shape, 15);
    expect(live).toEqual(new Set(["7,7", "8,7", "6,7", "7,8", "7,6"]));
  });

  test("neighbours off the edge are not anchors", () => {
    const live = anchors(makeBoard([{ x: 0, y: 0, letter: "A", isBlank: false }]), shape, 15);
    expect(live).toEqual(new Set(["0,0", "1,0", "0,1"]));
  });
});

describe("the component search", () => {
  test("opens across the centre", () => {
    const moves = find(makeBoard([]), ["C", "A", "T"]);

    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.placements.some((p) => p.x === 7 && p.y === 7))).toBe(true);
  });

  test("every move it returns is legal", () => {
    const board = makeBoard([..."CAT"].map((letter, i) => ({
      x: 6 + i, y: 7, letter, isBlank: false, stacked: 1,
    })));

    const moves = find(board, ["S", "O", "E", "A"]);
    expect(moves.length).toBeGreaterThan(0);

    for (const move of moves) {
      const legality = validateTurn(board, move.placements, dictionary,
        { width: 15, height: 15, blocked: shape.blocked, centre: shape.centre });
      expect(legality).toEqual({ ok: true });
    }
  });

  test("scores against the board it was given, not the board it makes", () => {
    const board = makeBoard([..."CAT"].map((letter, i) => ({
      x: 6 + i, y: 7, letter, isBlank: false, stacked: 1,
    })));

    // CATS: four letters, three of them already down. One tile, four points.
    // The S on the end, not the S laid over the C -- that one is SAT, and it
    // collects a stacking bonus on top of its three letters.
    const cats = find(board, ["S"]).find((m) =>
      m.placements.length === 1 && m.placements[0]?.x === 9);
    expect(cats!.score).toBe(4);
  });

  test("finds nothing when the rack cannot reach the board", () => {
    const board = makeBoard([{ x: 7, y: 7, letter: "A", isBlank: false }]);
    expect(find(board, ["Q", "Z"])).toEqual([]);
  });

  test("offers each turn once", () => {
    const board = makeBoard([..."CAT"].map((letter, i) => ({
      x: 6 + i, y: 7, letter, isBlank: false, stacked: 1,
    })));

    // The same placement is reachable from more than one span -- laying S on
    // the end of CAT is found as part of CATS and again as part of ATS. The
    // search used to return it twice, which lets the difficulty bands count
    // one move as several.
    const keys = find(board, ["S", "O", "A"]).map((m) => moveKey(m.placements));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("stays inside its time budget on a busy board", () => {
    // A mid-game board: a cross of words with plenty of anchors around it.
    const tiles = [
      ...[..."CATS"].map((letter, i) => ({ x: 5 + i, y: 7, letter, isBlank: false })),
      ...[..."OAT"].map((letter, i) => ({ x: 5, y: 8 + i, letter, isBlank: false })),
      ...[..."NET"].map((letter, i) => ({ x: 8 + i, y: 5, letter, isBlank: false })),
    ];
    const board = makeBoard(tiles);

    const started = performance.now();
    for (let i = 0; i < 20; i++) find(board, ["S", "O", "E", "A", "T", "N", "C"]);
    const each = (performance.now() - started) / 20;

    // Generous, because CI machines vary. This exists to catch a regression of
    // the kind that makes chaining unaffordable, not to police milliseconds.
    expect(each).toBeLessThan(50);
  });
});
