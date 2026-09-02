import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { makeBoard, type Board } from "../engine/board";
import { makeDictionary } from "../engine/dictionary";
import { applyPlacements, validateTurn } from "../engine/legality";
import { scoreTurn } from "../engine/score";
import { indexWords } from "./words";
import { rank } from "./bot";

/*
 * The real dictionary, because a toy one makes toy boards -- and the moves
 * worth catching are the ones that only appear when there is enough of a board
 * to build on.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const all: string[] = JSON.parse(
  readFileSync(join(ROOT, "shared", "data", "words.json"), "utf8"),
);
const dictionary = makeDictionary(all);
const words = indexWords(all.filter((w) => w.length <= 7), 7);
const shape = boardShapeNamed(OPEN_BOARD, 15);
const bounds = { width: 15, height: 15, blocked: shape.blocked, centre: shape.centre };

const LETTERS = "AAAABBCCDDEEEEEFFGGHHIIIIJKLLMMNNNOOOOPPQRRRSSSTTTUUVWXYZ";

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("every move the search offers is legal", () => {
  /*
   * Boards are grown by playing the search's own moves, so they are the
   * boards the bot actually meets rather than ones invented for the test.
   * Every move offered at every step is checked, not just the one taken.
   *
   * The cap is per case, and generous on purpose. `rank(..., {})` runs on this
   * module's own defaults, so raising them to the live bot's (`maxBlocks` 40,
   * `maxK` 3) is a change to what this test costs: measured cold inside the
   * full two-project run, the slowest case went from about 4s to 4.99s -- the
   * wider shortlist is nearly free here because these racks carry at most one
   * blank. Three minutes is thirty-six times that. The old 60s was twelve
   * times its own measurement and still timed out once when the machine was
   * running several test suites at once, which is the failure this cap is
   * sized against: a safety net that fails spuriously is one the next person
   * deletes. Nothing here should ever approach it, so a case that does has
   * found a real hang rather than a slow laptop.
   */
  test.each([1, 2, 3, 4, 5, 6, 7, 8])("game seeded %i", { timeout: 180_000 }, (seed) => {
    const rng = seeded(seed);
    let board: Board = makeBoard([]);
    let checked = 0;

    for (let turn = 0; turn < 25; turn++) {
      const letters = Array.from({ length: 7 }, () =>
        LETTERS[Math.floor(rng() * LETTERS.length)]);
      const blanks = turn % 5 === 0 ? 1 : 0;
      const before = board;

      const moves = rank(board, { letters, blanks }, dictionary, words, shape, 15,
        (b, p) => scoreTurn(b, p, { before }).total, {});

      for (const move of moves) {
        // The real check, with no `connected` shortcut: the full rules.
        const legality = validateTurn(before, move.placements, dictionary, bounds);
        if (!legality.ok) {
          throw new Error(
            `illegal move offered on turn ${turn}: ` +
            `${JSON.stringify(move.placements)} — ${JSON.stringify(legality.faults)} — ` +
            `board: ${JSON.stringify([...before.entries()])}`,
          );
        }
        checked++;
      }

      if (moves.length === 0) break;
      const picked = moves[Math.floor(rng() * moves.length)];
      board = applyPlacements(board, picked.placements);
    }

    // A test that checked nothing would pass silently.
    expect(checked).toBeGreaterThan(50);
  });
});

describe("the search reports what its own scoring callback computed", () => {
  /*
   * Both sides call scoreTurn on the same inputs, so this cannot catch an
   * arithmetic bug in scoreTurn itself -- it only checks that the search
   * hands its callback the board and `before` it claims to, i.e. board-and-
   * placement plumbing, not scoring correctness. It is not worthless: the
   * callback reads its own `before` argument rather than closing over one,
   * so a chained turn that let `before` drift to an intermediate board
   * (instead of staying pinned to the board the whole turn started on)
   * would make the two sides differ. Do not over-trust it for more than
   * that.
   */
  test("move.score matches its own callback's scoring of the claimed board and placements",
    { timeout: 60_000 }, () => {
    const rng = seeded(99);
    let board: Board = makeBoard([]);

    for (let turn = 0; turn < 12; turn++) {
      const letters = Array.from({ length: 7 }, () =>
        LETTERS[Math.floor(rng() * LETTERS.length)]);
      const before = board;

      const moves = rank(board, { letters, blanks: 0 }, dictionary, words, shape, 15,
        (after, p, turnBefore) => scoreTurn(after, p, { before: turnBefore }).total, {});
      if (moves.length === 0) break;

      for (const move of moves.slice(0, 40)) {
        const after = applyPlacements(before, move.placements);
        expect(move.score).toBe(scoreTurn(after, move.placements, { before }).total);
      }

      const top = moves[0];
      board = applyPlacements(board, top.placements);
    }
  });
});
