// A draft lives in localStorage, which the engine project's plain node has
// none of. Only *.test.tsx gets a DOM by default, and this is not a component.
// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from "vitest";
import { readDraft, writeDraft } from "./draft";

type Tile = { x: number; y: number; letter: string };
const TILES: readonly Tile[] = [{ x: 7, y: 7, letter: "A" }];

describe("a draft of a turn not yet played", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("comes back on the turn it was written for", () => {
    writeDraft("g1", 4, TILES, true);

    expect(readDraft<Tile>("g1", 4, true)).toEqual(TILES);
  });

  test("is gone once the turn has moved on", () => {
    writeDraft("g1", 4, TILES, true);

    expect(readDraft<Tile>("g1", 5, true)).toEqual([]);
  });

  test("is not restored onto a game that is over, and is forgotten", () => {
    // Quitting ends a game without moving the turn on, so a draft went on
    // matching the turn it was written for and came back on a board nobody
    // could play -- the tiles, and the words chipped and crossed out beside
    // them.
    writeDraft("g1", 4, TILES, true);

    expect(readDraft<Tile>("g1", 4, false)).toEqual([]);
    expect(window.localStorage.getItem("kraftwerd:draft:g1")).toBeNull();
  });

  test("is not kept for a game that is over", () => {
    writeDraft("g1", 4, TILES, false);

    expect(window.localStorage.getItem("kraftwerd:draft:g1")).toBeNull();
  });
});
