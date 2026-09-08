import { describe, expect, test } from "vitest";
import { candidates, indexWords, rackWords, withOneCovered } from "./words";

describe("the word index", () => {
  const index = indexWords(["CAT", "COT", "CATS", "AT", "TO"], 7);

  test("groups words by length", () => {
    expect(index.byLength.get(3)!.words.sort()).toEqual(["CAT", "COT"]);
    expect(index.byLength.get(4)!.words).toEqual(["CATS"]);
  });

  test("knows every word regardless of length", () => {
    expect(index.has("CATS")).toBe(true);
    expect(index.has("DOG")).toBe(false);
  });

  test("finds words the rack can spell outright", () => {
    const three = index.byLength.get(3)!;
    // Letters must arrive sorted: rackWords skips duplicate subsets by
    // comparing neighbours.
    const found = rackWords(three, ["A", "C", "T"], 3).map((i) => three.words[i]);
    expect(found).toEqual(["CAT"]);
  });

  test("finds words matching letters fixed at positions", () => {
    const three = index.byLength.get(3)!;
    const found = candidates(three, [[0, "C"], [2, "T"]])!.map((i) => three.words[i]);
    expect(found.sort()).toEqual(["CAT", "COT"]);
  });

  test("returns null when nothing is fixed", () => {
    expect(candidates(index.byLength.get(3)!, [])).toBeNull();
  });

  /*
   * `candidates` intersects posting lists by linear merge, which is only
   * correct because they are ascending -- they are built by pushing each
   * word's index as it is appended. If that ever stops being true the merge
   * quietly returns the wrong words rather than failing, so it is pinned here.
   */
  test("keeps every posting list strictly ascending", () => {
    const many = indexWords(
      ["CAT", "COT", "CATS", "COTS", "AT", "TO", "OAT", "OATS", "SAT", "SEA",
       "TEA", "EAT", "ATE", "ACE", "TEN", "NET", "AN", "ON", "NO", "SO"],
      7,
    );

    for (const [length, byLength] of many.byLength) {
      for (const [key, list] of byLength.posting) {
        const ascending = list.every((at, i) => i === 0 || at > list[i - 1]);
        expect({ length, key, ascending }).toEqual({ length, key, ascending: true });
      }
    }
  });
});

/*
 * Covering is offered per position, and not every position can take a tile:
 * a square already at STACK_CAP is full, and a square an earlier link of the
 * same turn laid on is spoken for. `fit` and `validateTurn` refuse both, so
 * every word retrieved for them is looked up and walked only to be thrown
 * away. Asking for them at all is the waste this pins.
 */
describe("covering a standing letter", () => {
  const index = indexWords(["CAT", "COT", "BAT", "CAB"], 7);
  const three = index.byLength.get(3)!;
  // The board says CAT; BAT covers position 0, COT position 1, CAB position 2.
  const fixed: [number, string][] = [[0, "C"], [1, "A"], [2, "T"]];
  const named = (pool: number[]) => pool.map((i) => three.words[i]!).sort();

  test("leaves out words that would cover a square nothing may be laid on", () => {
    expect(named(withOneCovered(three, fixed, [], new Set([1, 2])))).toEqual(["CAB", "CAT", "COT"]);
  });
});
