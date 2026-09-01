import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { cellKey, makeBoard, type Board } from "../engine/board";
import { makeDictionary } from "../engine/dictionary";
import { validateTurn } from "../engine/legality";
import { scoreTurn } from "../engine/score";
import { indexWords } from "./words";
import { blockMoves, candidateBlocks } from "./blocks";

const WORDS = ["ACE", "CAM", "EMU", "AC", "CA", "EM", "ME", "AE", "MU", "UM",
  "AT", "CAT", "CATS", "AS", "SO", "ON", "NO", "OAT"];
const dictionary = makeDictionary(WORDS);
const words = indexWords(WORDS, 7);
const shape = boardShapeNamed(OPEN_BOARD, 15);
const bounds = { width: 15, height: 15, blocked: shape.blocked, centre: shape.centre };

const solve = (board: Board, letters: string[], blanks = 0) =>
  blockMoves(board, { letters, blanks }, dictionary, words, shape, 15,
    (after, p, before) => scoreTurn(after, p, { before }).total, {});

describe("candidate blocks", () => {
  test("ignores blocks with no way to reach the board", () => {
    const board = makeBoard([{ x: 7, y: 7, letter: "A", isBlank: false }]);
    const blocks = candidateBlocks(board, shape, 15, 7, 3);

    // Every candidate either contains a tile or sits next to one.
    for (const block of blocks) {
      const cells = [];
      for (let dy = -1; dy <= block.k; dy++) {
        for (let dx = -1; dx <= block.k; dx++) cells.push(cellKey(block.x + dx, block.y + dy));
      }
      expect(cells.some((key) => board.has(key))).toBe(true);
    }
  });

  test("ignores blocks needing more tiles than the rack holds", () => {
    const board = makeBoard([{ x: 7, y: 7, letter: "A", isBlank: false }]);
    for (const block of candidateBlocks(board, shape, 15, 3, 3)) {
      expect(block.empties.length).toBeLessThanOrEqual(3);
    }
  });

  test("ignores blocks that are already full", () => {
    const board = makeBoard([
      { x: 7, y: 7, letter: "A", isBlank: false }, { x: 8, y: 7, letter: "C", isBlank: false },
      { x: 7, y: 8, letter: "C", isBlank: false }, { x: 8, y: 8, letter: "A", isBlank: false },
    ]);
    expect(candidateBlocks(board, shape, 15, 7, 2)
      .some((b) => b.k === 2 && b.x === 7 && b.y === 7)).toBe(false);
  });
});

describe("the block solver", () => {
  test("builds a 3x3 word square in one turn", () => {
    //   A C E
    //   C A M     across and down both read ACE, CAM, EMU
    //   E M U
    // Six of nine already down; the rack supplies the rest.
    const board = makeBoard([
      { x: 6, y: 6, letter: "A", isBlank: false }, { x: 7, y: 6, letter: "C", isBlank: false },
      { x: 8, y: 6, letter: "E", isBlank: false }, { x: 6, y: 7, letter: "C", isBlank: false },
      { x: 7, y: 7, letter: "A", isBlank: false }, { x: 8, y: 7, letter: "M", isBlank: false },
    ]);

    const moves = solve(board, ["E", "M", "U"]);
    const full = moves.find((m) => m.placements.length === 3);

    expect(full).toBeDefined();
    expect(new Set(full!.placements.map((p) => `${p.x},${p.y},${p.letter}`)))
      .toEqual(new Set(["6,8,E", "7,8,M", "8,8,U"]));
  });

  test("the completed 3x3 pays for the square and its nested 2x2s", () => {
    const board = makeBoard([
      { x: 6, y: 6, letter: "A", isBlank: false }, { x: 7, y: 6, letter: "C", isBlank: false },
      { x: 8, y: 6, letter: "E", isBlank: false }, { x: 6, y: 7, letter: "C", isBlank: false },
      { x: 7, y: 7, letter: "A", isBlank: false }, { x: 8, y: 7, letter: "M", isBlank: false },
    ]);

    const full = solve(board, ["E", "M", "U"]).find((m) => m.placements.length === 3)!;
    // Two 2x2s close (4 each) and the 3x3 (9), on top of the words formed.
    expect(full.score).toBeGreaterThanOrEqual(9 + 4 + 4);
  });

  test("every solution is legal", () => {
    const board = makeBoard([
      { x: 6, y: 6, letter: "A", isBlank: false }, { x: 7, y: 6, letter: "C", isBlank: false },
      { x: 8, y: 6, letter: "E", isBlank: false }, { x: 6, y: 7, letter: "C", isBlank: false },
      { x: 7, y: 7, letter: "A", isBlank: false }, { x: 8, y: 7, letter: "M", isBlank: false },
    ]);

    const moves = solve(board, ["E", "M", "U", "A", "C"]);
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      expect(validateTurn(board, move.placements, dictionary, bounds)).toEqual({ ok: true });
    }
  });

  test("finds nothing when the rack cannot spell the square", () => {
    const board = makeBoard([
      { x: 6, y: 6, letter: "A", isBlank: false }, { x: 7, y: 6, letter: "C", isBlank: false },
      { x: 8, y: 6, letter: "E", isBlank: false }, { x: 6, y: 7, letter: "C", isBlank: false },
      { x: 7, y: 7, letter: "A", isBlank: false }, { x: 8, y: 7, letter: "M", isBlank: false },
    ]);

    expect(solve(board, ["X", "X", "X"]).some((m) => m.placements.length === 3)).toBe(false);
  });

  test("a blank can stand in for a letter the rack lacks", () => {
    const board = makeBoard([
      { x: 6, y: 6, letter: "A", isBlank: false }, { x: 7, y: 6, letter: "C", isBlank: false },
      { x: 8, y: 6, letter: "E", isBlank: false }, { x: 6, y: 7, letter: "C", isBlank: false },
      { x: 7, y: 7, letter: "A", isBlank: false }, { x: 8, y: 7, letter: "M", isBlank: false },
    ]);

    const moves = blockMoves(board, { letters: ["E", "M"], blanks: 1 }, dictionary, words,
      shape, 15, (after, p, before) => scoreTurn(after, p, { before }).total, {});

    const full = moves.find((m) => m.placements.length === 3);
    expect(full).toBeDefined();
    expect(full!.placements.some((p) => p.isBlank)).toBe(true);
  });
});
