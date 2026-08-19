import { describe, expect, test } from "vitest";
import { makeBoard } from "./board.js";
import {
  applyPlacements,
  validateTurn,
  wordsFormed,
  type Bounds,
  type Dictionary,
} from "./legality.js";
import type { Placement } from "./score.js";

const dict = (...words: string[]): Dictionary => {
  const set = new Set(words.map((w) => w.toUpperCase()));
  return { has: (w) => set.has(w.toUpperCase()) };
};

const bounds: Bounds = { width: 20, height: 20 };

const at = (x: number, y: number, letter: string, isBlank = false): Placement => ({
  x,
  y,
  letter,
  isBlank,
});

describe("validateTurn", () => {
  test("rejects a tile placed on an occupied cell", () => {
    const board = makeBoard([{ x: 3, y: 3, letter: "A" }]);

    expect(validateTurn(board, [at(3, 3, "B")], dict(), bounds)).toEqual({
      ok: false,
      reason: "occupied",
      at: { x: 3, y: 3 },
    });
  });

  test("rejects a run that is not in the dictionary", () => {
    const board = makeBoard([]);

    expect(
      validateTurn(board, [at(0, 0, "X"), at(1, 0, "Q")], dict("CAT"), bounds),
    ).toEqual({ ok: false, reason: "invalid-words", words: ["XQ"] });
  });

  test("rejects a tile outside the board", () => {
    expect(validateTurn(makeBoard([]), [at(20, 0, "A")], dict(), bounds)).toEqual({
      ok: false,
      reason: "out-of-bounds",
      at: { x: 20, y: 0 },
    });
  });

  test("rejects a negative coordinate", () => {
    expect(validateTurn(makeBoard([]), [at(0, -1, "A")], dict(), bounds)).toEqual({
      ok: false,
      reason: "out-of-bounds",
      at: { x: 0, y: -1 },
    });
  });

  test("rejects a turn that places nothing", () => {
    expect(validateTurn(makeBoard([]), [], dict(), bounds)).toEqual({
      ok: false,
      reason: "empty-turn",
    });
  });

  test("rejects two tiles on the same cell", () => {
    expect(
      validateTurn(makeBoard([]), [at(2, 2, "A"), at(2, 2, "B")], dict(), bounds),
    ).toEqual({ ok: false, reason: "duplicate-cell", at: { x: 2, y: 2 } });
  });

  test("rejects a play that does not touch the existing mass", () => {
    const board = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
    ]);

    // a legal word, but placed miles away touching nothing
    expect(
      validateTurn(board, [at(15, 15, "T"), at(16, 15, "O")], dict("AT", "TO"), bounds),
    ).toEqual({ ok: false, reason: "disconnected" });
  });

  test("accepts a play that touches the existing mass", () => {
    const board = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
    ]);

    // T under the A makes AT down
    expect(validateTurn(board, [at(0, 1, "T")], dict("AT"), bounds)).toEqual({ ok: true });
  });

  test("rejects a turn that leaves two separate masses", () => {
    // opening play: two valid words with a gap between them
    const placements = [at(0, 0, "A"), at(1, 0, "T"), at(5, 0, "T"), at(6, 0, "O")];

    expect(validateTurn(makeBoard([]), placements, dict("AT", "TO"), bounds)).toEqual({
      ok: false,
      reason: "disconnected",
    });
  });

  test("accepts a group that reaches the mass through its own tiles", () => {
    const board = makeBoard([{ x: 0, y: 0, letter: "A" }]);

    // only (1,0) touches the existing A; (2,0) rides along
    expect(validateTurn(board, [at(1, 0, "C"), at(2, 0, "E")], dict("ACE"), bounds)).toEqual({
      ok: true,
    });
  });

  test("accepts a 2x2 whose four runs are all words", () => {
    // A T
    // T O
    const placements = [at(0, 0, "A"), at(1, 0, "T"), at(0, 1, "T"), at(1, 1, "O")];

    expect(validateTurn(makeBoard([]), placements, dict("AT", "TO"), bounds)).toEqual({
      ok: true,
    });
  });

  test("rejects a 2x2 whose columns are not words", () => {
    // A T   rows AT / TO are fine, columns AT / TO are not both valid here
    // T O
    const placements = [at(0, 0, "A"), at(1, 0, "T"), at(0, 1, "T"), at(1, 1, "O")];
    const result = validateTurn(makeBoard([]), placements, dict("AT"), bounds);

    expect(result).toEqual({ ok: false, reason: "invalid-words", words: ["TO"] });
  });

  test("rejects when a placement breaks a word it did not create", () => {
    // existing AT; appending Z makes ATZ
    const board = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
    ]);

    expect(validateTurn(board, [at(2, 0, "Z")], dict("AT"), bounds)).toEqual({
      ok: false,
      reason: "invalid-words",
      words: ["ATZ"],
    });
  });

  // A one-tile run can only ever occur on the opening play: from then on
  // connectivity guarantees every placed tile has a neighbour.
  test("accepts a lone opening tile that is itself a word", () => {
    expect(validateTurn(makeBoard([]), [at(5, 5, "A")], dict("A", "I"), bounds)).toEqual({
      ok: true,
    });
  });

  test("rejects a lone opening tile that is not a word", () => {
    expect(validateTurn(makeBoard([]), [at(5, 5, "Q")], dict("A", "I"), bounds)).toEqual({
      ok: false,
      reason: "invalid-words",
      words: ["Q"],
    });
  });
});

describe("wordsFormed", () => {
  test("lists every run the placement creates, in both directions", () => {
    const board = makeBoard([{ x: 0, y: 0, letter: "A" }]);
    const after = applyPlacements(board, [at(1, 0, "T"), at(1, 1, "O")]);

    expect(wordsFormed(after, [at(1, 0, "T"), at(1, 1, "O")]).sort()).toEqual(["AT", "TO"]);
  });

  test("includes a lone tile's own letter so the opening play can be checked", () => {
    const after = applyPlacements(makeBoard([]), [at(4, 4, "A")]);

    expect(wordsFormed(after, [at(4, 4, "A")])).toEqual(["A"]);
  });
});

describe("a board with blocked squares and a centre", () => {
  const shaped: Bounds = {
    width: 5,
    height: 5,
    blocked: new Set(["1,1"]),
    centre: { x: 2, y: 2 },
  };

  test("rejects a tile on a blocked square", () => {
    expect(validateTurn(makeBoard([]), [at(1, 1, "A")], dict("A"), shaped)).toEqual({
      ok: false,
      reason: "blocked",
      at: { x: 1, y: 1 },
    });
  });

  test("rejects an opening play that misses the centre", () => {
    expect(
      validateTurn(makeBoard([]), [at(0, 0, "A"), at(1, 0, "T")], dict("AT"), shaped),
    ).toEqual({ ok: false, reason: "missing-centre" });
  });

  test("accepts an opening play that covers the centre", () => {
    expect(
      validateTurn(makeBoard([]), [at(2, 2, "A"), at(3, 2, "T")], dict("AT"), shaped),
    ).toEqual({ ok: true });
  });

  test("only the opening play must reach the centre", () => {
    const board = makeBoard([
      { x: 2, y: 2, letter: "A" },
      { x: 3, y: 2, letter: "T" },
    ]);

    expect(validateTurn(board, [at(4, 2, "E")], dict("ATE"), shaped)).toEqual({
      ok: true,
    });
  });

  test("a blocked square cannot be bridged across", () => {
    // (1,1) is blocked, so a word cannot run through it.
    const board = makeBoard([{ x: 2, y: 2, letter: "A" }]);

    expect(validateTurn(board, [at(0, 1, "A"), at(2, 1, "T")], dict("AT", "A"), shaped)).toEqual(
      { ok: false, reason: "disconnected" },
    );
  });
});
