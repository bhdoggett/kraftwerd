import { describe, expect, test } from "vitest";
import words from "../../shared/data/words.json" with { type: "json" };
import { boardShapeNamed } from "../../shared/boards";
import { makeBoard, type Board } from "../../shared/engine/board";
import { makeDictionary } from "../../shared/engine/dictionary";
import { applyPlacements, validateTurn, wordsFormed } from "../../shared/engine/legality";
import { BOARD_SIZE, LAYOUT, PLAYER_SEAT, SCRIPT } from "./script";
import { checkPlacement, factsFor, standingsAfter, tilesAfter } from "./model";

const dict = makeDictionary(words);

function boardOf(turns: number): Board {
  return makeBoard(tilesAfter(turns));
}

describe("the recorded game", () => {
  test("every turn is legal and scores what was recorded", () => {
    const shape = boardShapeNamed(LAYOUT, BOARD_SIZE);
    SCRIPT.forEach((turn, i) => {
      const before = boardOf(i);
      const bounds = { width: BOARD_SIZE, height: BOARD_SIZE, blocked: shape.blocked, centre: shape.centre };
      expect(validateTurn(before, turn.placements, dict, bounds), `turn ${i + 1}`).toEqual({ ok: true });
      const after = applyPlacements(before, turn.placements);
      expect(wordsFormed(after, turn.placements)).toEqual(turn.words);
      expect(factsFor(i).score.total).toBe(turn.score);
    });
  });

  test("3x3 squares land on turns 2, 4, 6, 12, 14 and 17", () => {
    expect(SCRIPT.map((_, i) => (factsFor(i).score.squares.length > 0 ? i + 1 : null)).filter(Boolean))
      .toEqual([2, 4, 6, 12, 14, 17]);
  });

  test("a new square names every cell of its 3x3", () => {
    const facts = factsFor(1);
    expect(facts.newSquares.length).toBe(9 * facts.score.squares.length);
    expect(factsFor(0).newSquares).toEqual([]);
  });

  test("final scores are 264, 239, 253", () => {
    expect(standingsAfter(17).seats.map((s) => s.score)).toEqual([264, 239, 253]);
  });

  test("bag and hands", () => {
    expect(standingsAfter(0)).toMatchObject({ bagLeft: 78 });
    expect(standingsAfter(11).bagLeft).toBe(3);
    expect(standingsAfter(12).bagLeft).toBe(0);
    expect(standingsAfter(13).seats[0]).toMatchObject({ tilesInHand: 0, blanks: 0, out: true });
    expect(standingsAfter(17).seats.every((s) => s.out)).toBe(true);
  });

  test("a stacked tile replaces the letter and counts the stack", () => {
    const t = tilesAfter(3).find((t) => t.x === 7 && t.y === 9);
    expect(t).toMatchObject({ letter: "K", stacked: 2, placedBy: "seat2" });
  });

  test("the player never stacks a letter onto the same letter", () => {
    SCRIPT.forEach((turn, i) => {
      if (turn.seat !== PLAYER_SEAT) return;
      const before = tilesAfter(i);
      for (const p of turn.placements) {
        const sitting = before.find((t) => t.x === p.x && t.y === p.y);
        expect(sitting === undefined || sitting.letter !== p.letter).toBe(true);
      }
    });
  });
});

describe("checkPlacement", () => {
  test("judges staged tiles against the ghosts", () => {
    const want = SCRIPT[1].placements;
    expect(checkPlacement(1, [])).toEqual({ kind: "missing", count: 6 });
    expect(checkPlacement(1, want)).toEqual({ kind: "ready" });
    // the two Ns swapped are still ready
    const swapped = want.map((p) => (p.letter === "N" ? { ...p, x: p.x === 8 ? 6 : 8, y: p.x === 8 ? 7 : 9 } : p));
    expect(checkPlacement(1, swapped)).toEqual({ kind: "ready" });
    // B one square right of its ghost
    const off = want.map((p) => (p.letter === "B" ? { ...p, x: 10 } : p));
    expect(checkPlacement(1, off)).toEqual({ kind: "offGhost", letter: "B", x: 10, y: 10, target: { x: 9, y: 10 } });
    // T on the A's square, A on the T's square
    const crossed = want.map((p) => (p.letter === "T" ? { ...p, x: 7, y: 9 } : p.letter === "A" ? { ...p, x: 8, y: 7 } : p));
    expect(checkPlacement(1, crossed)).toMatchObject({ kind: "wrongLetter" });
    // all six right plus a stray seventh tile is still off a ghost
    expect(checkPlacement(1, [...want, { x: 0, y: 0, letter: "Q", isBlank: false }])).toMatchObject({
      kind: "offGhost",
      x: 0,
      y: 0,
    });
  });

  test("a blank and a real tile of one letter are interchangeable", () => {
    // Turn 5: the real O is on 13,12, the blank O on 12,10.
    const want = SCRIPT[4].placements;
    expect(checkPlacement(4, want)).toEqual({ kind: "ready" });
    const swapped = want.map((p) =>
      p.letter === "O" ? { ...p, isBlank: !p.isBlank } : p,
    );
    expect(swapped.filter((p) => p.letter === "O").map((p) => p.isBlank).sort()).toEqual([false, true]);
    expect(checkPlacement(4, swapped)).toEqual({ kind: "ready" });
  });

  test("wrongLetter never names the same letter twice", () => {
    for (let turn = 0; turn < SCRIPT.length; turn++) {
      const want = SCRIPT[turn].placements;
      // Every tile one ghost over (rotated): letters rarely line up, and a
      // blank counts only by its letter.
      const rotated = want.map((p, i) => {
        const g = want[(i + 1) % want.length];
        return { ...p, x: g.x, y: g.y };
      });
      const f = checkPlacement(turn, rotated);
      if (f.kind === "wrongLetter") expect(f.placed).not.toBe(f.wanted);
    }
  });
});
