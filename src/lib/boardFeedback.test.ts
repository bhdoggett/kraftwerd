import { describe, expect, test } from "vitest";
import { makeBoard } from "../../shared/engine/board";
import type { Placement } from "../../shared/engine/score";
import { markCells } from "./boardFeedback";

const at = (x: number, y: number, letter: string): Placement => ({
  x,
  y,
  letter,
  isBlank: false,
});

const valid = (...words: string[]) => new Map(words.map((w) => [w, true]));

/** A board pair for a turn played onto nothing. */
const onEmpty = (after: ReturnType<typeof makeBoard>) => ({
  before: makeBoard([]),
  after,
});

describe("markCells", () => {
  test("marks placed tiles of a word that checks out", () => {
    const placements = [at(0, 0, "A"), at(1, 0, "T")];
    const { good, bad } = markCells(onEmpty(makeBoard(placements)), placements, valid("AT"));

    expect([...good].sort()).toEqual(["0,0", "1,0"]);
    expect([...bad]).toEqual([]);
  });

  test("marks a word that is not in the dictionary", () => {
    const placements = [at(0, 0, "X"), at(1, 0, "Q")];
    const { good, bad } = markCells(onEmpty(makeBoard(placements)), placements, valid());

    expect([...bad].sort()).toEqual(["0,0", "1,0"]);
    expect([...good]).toEqual([]);
  });

  test("does not mark tiles that were already on the board", () => {
    const board = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
      { x: 2, y: 0, letter: "E" },
    ]);
    const before = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
    ]);
    const { good } = markCells({ before, after: board }, [at(2, 0, "E")], valid("ATE"));

    // The whole word is judged, but only this turn's tile is coloured.
    expect([...good]).toEqual(["2,0"]);
  });

  test("a square in a good word one way and a bad one the other shows the problem", () => {
    // A T   across AT is a word, down AT and TO are not both known here.
    // T O
    const placements = [at(0, 0, "A"), at(1, 0, "T"), at(0, 1, "T"), at(1, 1, "O")];
    const { good, bad } = markCells(onEmpty(makeBoard(placements)), placements, valid("AT"));

    expect(bad.has("1,1")).toBe(true);
    expect(good.has("1,1")).toBe(false);
  });

  test("a lone tile has to be a word in its own right", () => {
    const lone = markCells(
      onEmpty(makeBoard([at(4, 4, "Q")])),
      [at(4, 4, "Q")],
      valid("A", "I"),
    );
    expect([...lone.bad]).toEqual(["4,4"]);

    const ok = markCells(
      onEmpty(makeBoard([at(4, 4, "A")])),
      [at(4, 4, "A")],
      valid("A", "I"),
    );
    expect([...ok.good]).toEqual(["4,4"]);
  });

  test("a good word that does not reach the board is still marked wrong", () => {
    const board = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 5, y: 5, letter: "A" },
      { x: 6, y: 5, letter: "T" },
    ]);
    const placements = [at(5, 5, "A"), at(6, 5, "T")];
    const before = makeBoard([{ x: 0, y: 0, letter: "A" }]);
    const { bad } = markCells({ before, after: board }, placements, valid("AT", "A"));

    expect([...bad].sort()).toEqual(["5,5", "6,5"]);
  });

  /*
   * Paving over a word is refused by the rules (legality's "erased" fault),
   * but the board used to colour these tiles green because the word they
   * spell is a real one -- a green play sitting under a refusal message.
   */
  test("tiles that bury a word whole are marked wrong, however good their own word", () => {
    const before = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
    ]);
    const placements = [at(0, 0, "D"), at(1, 0, "O")];
    const after = makeBoard([
      { x: 0, y: 0, letter: "D" },
      { x: 1, y: 0, letter: "O" },
    ]);

    const { good, bad } = markCells({ before, after }, placements, valid("DO"));

    expect([...bad].sort()).toEqual(["0,0", "1,0"]);
    expect([...good]).toEqual([]);
  });

  test("a word with a letter still standing is not buried, so its cover stays good", () => {
    const before = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
      { x: 2, y: 0, letter: "E" },
    ]);
    const placements = [at(0, 0, "D"), at(1, 0, "O")];
    const after = makeBoard([
      { x: 0, y: 0, letter: "D" },
      { x: 1, y: 0, letter: "O" },
      { x: 2, y: 0, letter: "E" },
    ]);

    const { good, bad } = markCells({ before, after }, placements, valid("DOE"));

    expect([...good].sort()).toEqual(["0,0", "1,0"]);
    expect([...bad]).toEqual([]);
  });

  test("only the burying tiles go wrong, not the rest of the play", () => {
    // AT is paved over at 0,0-1,0; the tile at 3,0 is nowhere near it.
    const before = makeBoard([
      { x: 0, y: 0, letter: "A" },
      { x: 1, y: 0, letter: "T" },
    ]);
    const placements = [at(0, 0, "D"), at(1, 0, "O"), at(2, 0, "E")];
    const after = makeBoard([
      { x: 0, y: 0, letter: "D" },
      { x: 1, y: 0, letter: "O" },
      { x: 2, y: 0, letter: "E" },
    ]);

    const { good, bad } = markCells({ before, after }, placements, valid("DOE"));

    expect([...bad].sort()).toEqual(["0,0", "1,0"]);
    expect([...good]).toEqual(["2,0"]);
  });
});
