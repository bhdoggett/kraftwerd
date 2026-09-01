import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { cellKey, makeBoard, type Board } from "../engine/board";
import { makeDictionary } from "../engine/dictionary";
import { applyPlacements, validateTurn } from "../engine/legality";
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

  /*
   * An empty board has nothing to join, so the reachability test can never
   * pass on one -- which is why the centre test has to be asked first. Written
   * the other way round the whole opening branch is dead code and `blockMoves`
   * returns nothing on turn one. A reordering is exactly the kind of fix a
   * later edit undoes without noticing, because both orders read plausibly.
   */
  test("offers the opening square, and only blocks covering the centre", () => {
    const blocks = candidateBlocks(makeBoard([]), shape, 15, 7, 4);

    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(shape.centre.x).toBeGreaterThanOrEqual(block.x);
      expect(shape.centre.x).toBeLessThan(block.x + block.k);
      expect(shape.centre.y).toBeGreaterThanOrEqual(block.y);
      expect(shape.centre.y).toBeLessThan(block.y + block.k);
    }
  });
});

describe("the opening square", () => {
  test("a 2x2 can be laid on an empty board, and is legal", () => {
    // AC over CA: both rows and both columns read a word.
    const empty = makeBoard([]);
    const moves = solve(empty, ["A", "C", "C", "A"]);
    const opening = moves.find((m) => m.placements.length === 4);

    expect(opening).toBeDefined();
    expect(validateTurn(empty, opening!.placements, dictionary, bounds)).toEqual({ ok: true });
    // The opening has to cover the centre, and a 2x2 pays 4.
    expect(opening!.placements.some((p) => p.x === shape.centre.x && p.y === shape.centre.y))
      .toBe(true);
    expect(opening!.score).toBeGreaterThanOrEqual(4);
  });
});

/**
 * The turns that are the whole reason this module exists.
 *
 * Most word squares are reachable without it: a block whose gaps lie in one
 * line is an ordinary span, and one whose gaps can be filled a legal play at a
 * time is what chaining is for. The four corners of a 3x3 are neither. Put a
 * single corner down and its row and its column are each a two-letter fragment
 * of a three-letter word -- and if the fragment is not itself a word, there is
 * no legal first tile, so no search that composes legal plays can begin.
 *
 * The fixture's dictionary is deliberately just the three words of the square.
 * Add the fragments back -- `AC`, `EM`, `MU` are all real enough -- and the
 * corners become individually legal and the turn decomposes. That is not a
 * weakness of the test; it is the measured reason these turns are rare in real
 * play, written down where it can be seen.
 */
describe("turns that are legal only as a whole", () => {
  const SQUARE = ["ACE", "CAM", "EMU"];
  const squareDict = makeDictionary(SQUARE);
  const squareWords = indexWords(SQUARE, 7);

  //     6   7   8        CAM already down, across and down, as a plus.
  // 6   .   C   .        The four corners are missing, and only the four
  // 7   C   A   M        together are a legal turn.
  // 8   .   M   .
  const board = makeBoard([
    { x: 7, y: 6, letter: "C", isBlank: false }, { x: 6, y: 7, letter: "C", isBlank: false },
    { x: 7, y: 7, letter: "A", isBlank: false }, { x: 8, y: 7, letter: "M", isBlank: false },
    { x: 7, y: 8, letter: "M", isBlank: false },
  ]);

  const corners = () =>
    blockMoves(board, { letters: ["A", "E", "E", "U"], blanks: 0 }, squareDict, squareWords,
      shape, 15, (after, p, before) => scoreTurn(after, p, { before }).total, {})
      .find((m) => m.placements.length === 4);

  test("the solver finds the four corners", () => {
    const full = corners();

    expect(full).toBeDefined();
    expect(new Set(full!.placements.map((p) => `${p.x},${p.y},${p.letter}`)))
      .toEqual(new Set(["6,6,A", "8,6,E", "6,8,E", "8,8,U"]));
    // Not one line, so no single span reaches it either.
    expect(new Set(full!.placements.map((p) => p.x)).size).toBeGreaterThan(1);
    expect(new Set(full!.placements.map((p) => p.y)).size).toBeGreaterThan(1);
  });

  test("no part of it is a legal play, so no chain of legal plays builds it", () => {
    const placements = corners()!.placements;
    const squareBounds = { ...bounds };

    // The turn itself stands up.
    expect(validateTurn(board, placements, squareDict, squareBounds)).toEqual({ ok: true });

    // All fourteen proper, non-empty parts of it do not. A chained search has
    // to lay a legal play first; here there is none to lay.
    let legalParts = 0;
    for (let mask = 1; mask < (1 << placements.length) - 1; mask++) {
      const part = placements.filter((_, i) => (mask & (1 << i)) !== 0);
      if (validateTurn(board, part, squareDict, squareBounds).ok) legalParts++;
    }
    expect(legalParts).toBe(0);
  });

  test("and it pays for the 3x3 and all four 2x2s", () => {
    const full = corners()!;
    const scored = scoreTurn(applyPlacements(board, full.placements), full.placements,
      { before: board });

    // Every corner is the last tile of a different 2x2: 4 x 4, plus the 3x3.
    expect(scored.squarePoints).toBe(4 * 4 + 9);
    expect(full.score).toBe(scored.total);
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
