import { describe, expect, test } from "vitest";
import { livePremium, premiumCells, premiumMap, premiumSquares } from "../premium.js";
import { makeBoard } from "./board.js";
import { applyPlacements, validateTurn } from "./legality.js";
import { scoreTurn } from "./score.js";

const at = (x: number, y: number, letter: string) => ({ x, y, letter, isBlank: false });

describe("premium squares", () => {
  test("sit four in from each corner", () => {
    expect(premiumSquares(15)).toEqual([
      { x: 3, y: 3 },
      { x: 11, y: 3 },
      { x: 3, y: 11 },
      { x: 11, y: 11 },
    ]);
  });

  test("get the four letters between them, in an order that varies", () => {
    const inOrder = premiumCells(15, () => 0).map((c) => c.letter);
    const another = premiumCells(15, () => 0.999).map((c) => c.letter);

    expect([...inOrder].sort()).toEqual(["J", "Q", "X", "Z"]);
    expect([...another].sort()).toEqual(["J", "Q", "X", "Z"]);
    expect(another).not.toEqual(inOrder);
  });

  test("a word through one is worth double", () => {
    // JAB, using the J that is already on the board at 3,3.
    const board = makeBoard([at(3, 3, "J"), at(4, 3, "A"), at(5, 3, "B")]);
    const placements = [at(4, 3, "A"), at(5, 3, "B")];

    const plain = scoreTurn(board, placements);
    const doubled = scoreTurn(board, placements, { premium: premiumMap([{ x: 3, y: 3, letter: "J" }]) });

    expect(plain.total).toBe(3);
    expect(doubled.total).toBe(6);
  });

  test("a word that misses it is worth what it was", () => {
    const board = makeBoard([at(7, 7, "A"), at(8, 7, "T")]);
    const placements = [at(8, 7, "T")];

    expect(scoreTurn(board, placements, { premium: premiumMap([{ x: 3, y: 3, letter: "J" }]) }).total).toBe(
      scoreTurn(board, placements).total,
    );
  });

  test("a square containing one pays double too", () => {
    // A 2x2 in the corner, with the J in it: four letters, four for the
    // square, and the J doubles both the words it is in and the square.
    const board = makeBoard([
      at(3, 3, "J"),
      at(4, 3, "A"),
      at(3, 4, "A"),
      at(4, 4, "B"),
    ]);
    const placements = [at(4, 3, "A"), at(3, 4, "A"), at(4, 4, "B")];

    const plain = scoreTurn(board, placements);
    const doubled = scoreTurn(board, placements, { premium: premiumMap([{ x: 3, y: 3, letter: "J" }]) });

    expect(plain.squarePoints).toBe(4);
    expect(doubled.squarePoints).toBe(8);
  });
});

describe("reaching a premium square", () => {
  const bounds = {
    width: 15,
    height: 15,
    centre: { x: 7, y: 7 },
    premium: new Set(["3,3"]),
  };
  const dictionary = { has: (w: string) => ["AT", "JAB", "JA", "AB"].includes(w) };

  /** A board holding only its premium letters: nobody has played yet. */
  const fresh = () => makeBoard([at(3, 3, "J")]);

  test("the opening word still has to cover the centre", () => {
    const result = validateTurn(
      fresh(),
      [at(0, 0, "A"), at(1, 0, "T")],
      dictionary,
      bounds,
    );
    expect(result).toEqual({ ok: false, reason: "missing-centre" });
  });

  test("an opening across the centre is fine, even though a J sits in a corner", () => {
    const result = validateTurn(
      fresh(),
      [at(7, 7, "A"), at(8, 7, "T")],
      dictionary,
      bounds,
    );
    expect(result.ok).toBe(true);
  });

  test("you cannot start a word off a premium letter you have not reached", () => {
    const board = makeBoard([at(3, 3, "J"), at(7, 7, "A"), at(8, 7, "T")]);

    const result = validateTurn(board, [at(4, 3, "A"), at(5, 3, "B")], dictionary, bounds);
    expect(result).toEqual({ ok: false, reason: "disconnected" });
  });

  test("once your tiles arrive, the letter is yours to build through", () => {
    // A chain from the centre that stops one square short of the J.
    const played = [];
    for (let x = 5; x <= 7; x++) played.push(at(x, 3, "A"));
    for (let y = 3; y <= 7; y++) played.push(at(7, y, "A"));
    const board = makeBoard([at(3, 3, "J"), ...played]);

    // Filling the gap joins the chain to the J: the run reads through it.
    const anyWord = { has: () => true };
    const result = validateTurn(board, [at(4, 3, "A")], anyWord, bounds);
    expect(result.ok).toBe(true);
  });
});

describe("covering a premium square", () => {
  test("buries the letter and the bonus with it", () => {
    const cells = [{ x: 3, y: 3, letter: "J" }];
    const tileOnTop = [{ x: 3, y: 3 }];

    expect(livePremium(cells, [])).toEqual(cells);
    expect(livePremium(cells, tileOnTop)).toEqual([]);
  });

  test("a word through a buried corner is worth what it says", () => {
    // Someone has covered the J with an A: JAB is now AAB, and whatever it
    // scores, it does not double.
    const board = makeBoard([at(3, 3, "A"), at(4, 3, "A"), at(5, 3, "B")]);
    const placements = [at(4, 3, "A"), at(5, 3, "B")];
    const live = livePremium([{ x: 3, y: 3, letter: "J" }], [{ x: 3, y: 3 }]);

    expect(scoreTurn(board, placements, { premium: premiumMap(live) }).total).toBe(
      scoreTurn(board, placements).total,
    );
  });
});

describe("squares around a corner", () => {
  const corner = [{ x: 3, y: 3, letter: "J" }];

  /** The 2x2 whose top-left is the J corner. */
  const block = (topLeft: string) => [
    at(3, 3, topLeft),
    at(4, 3, "A"),
    at(3, 4, "A"),
    at(4, 4, "B"),
  ];

  test("completing it around the corner scores it, doubled", () => {
    const before = makeBoard([at(3, 3, "J")]);
    const after = makeBoard(block("J"));
    const placements = [at(4, 3, "A"), at(3, 4, "A"), at(4, 4, "B")];

    const score = scoreTurn(after, placements, { premium: premiumMap(corner), before });

    expect(score.squares).toEqual([2]);
    expect(score.squarePoints).toBe(8);
  });

  test("burying the corner later does not make the same square new again", () => {
    // The block is already complete, with the J still in it. Laying a tile on
    // the J changes the letter but not the fact that the square was there.
    const before = makeBoard(block("J"));
    const after = makeBoard(block("C"));

    const score = scoreTurn(after, [at(3, 3, "C")], {
      // The corner is buried by this very play, so nothing doubles.
      premium: premiumMap([]),
      before,
    });

    expect(score.squares).toEqual([]);
    expect(score.squarePoints).toBe(0);
  });
});

describe("stacking on a premium corner", () => {
  const bounds = {
    width: 15,
    height: 15,
    centre: { x: 7, y: 7 },
    premium: new Set(["3,3"]),
  };
  const anyWord = { has: () => true };

  test("the corner is the square's first tile, so two more may land there", () => {
    // The corner letter counts as one, exactly as a played tile would.
    const board = makeBoard([
      { x: 3, y: 3, letter: "J" },
      { x: 4, y: 3, letter: "A" },
    ]);
    expect(board.get("3,3")?.stacked).toBe(1);

    const first = applyPlacements(board, [at(3, 3, "C")]);
    expect(first.get("3,3")?.stacked).toBe(2);
    expect(validateTurn(board, [at(3, 3, "C")], anyWord, bounds).ok).toBe(true);

    const second = applyPlacements(first, [at(3, 3, "B")]);
    expect(second.get("3,3")?.stacked).toBe(3);

    // Full: the corner used one of the three lives the square ever had.
    expect(validateTurn(second, [at(3, 3, "D")], anyWord, bounds)).toEqual({
      ok: false,
      reason: "stack-full",
      at: { x: 3, y: 3 },
    });
  });
});
