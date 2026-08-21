import { describe, expect, test } from "vitest";
import { makeBoard } from "../engine/board";
import { premiumCells, premiumsClaimed, turnValue, type Variant } from "./variants";

const plain: Variant = { name: "t", bag: 0, multiplier: "none", premium: false };
const withPremium: Variant = { ...plain, premium: true };
const board = makeBoard([]);
const at = (x: number, y: number, letter: string) => ({ x, y, letter, isBlank: false });

describe("premium squares", () => {
  test("sit four in from each corner, symmetrically", () => {
    expect(premiumCells(15)).toEqual(["3,3", "11,3", "3,11", "11,11"]);
  });

  test("double the turn that first covers one", () => {
    const play = [at(3, 3, "A"), at(4, 3, "T")];

    const plainScore = turnValue(board, play, plain, new Set()).score;
    const premiumScore = turnValue(board, play, withPremium, new Set(), 15).score;

    expect(premiumScore).toBe(plainScore * 2);
  });

  test("pay once: a square already taken is an ordinary square", () => {
    const play = [at(3, 3, "A"), at(4, 3, "T")];
    const taken = new Set(["3,3"]);

    expect(turnValue(board, play, withPremium, new Set(), 15, taken).score).toBe(
      turnValue(board, play, plain, new Set()).score,
    );
    expect(premiumsClaimed(play, 15, taken)).toEqual([]);
  });

  test("a rare letter on a premium square doubles twice", () => {
    const rare: Variant = { ...withPremium, multiplier: "first" };
    const play = [at(3, 3, "Z"), at(4, 3, "A")];

    const base = turnValue(board, play, plain, new Set()).score;
    expect(turnValue(board, play, rare, new Set(), 15).score).toBe(base * 4);
  });

  test("a blank standing for a rare letter claims nothing", () => {
    const rare: Variant = { ...plain, multiplier: "first" };
    const play = [{ x: 5, y: 5, letter: "Z", isBlank: true }, at(6, 5, "A")];

    expect(turnValue(board, play, rare, new Set()).doubled).toEqual([]);
  });
});
