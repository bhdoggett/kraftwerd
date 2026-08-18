import { describe, expect, test } from "vitest";
import { makeDictionary } from "./dictionary.js";

describe("makeDictionary", () => {
  test("finds a word regardless of the case it is queried in", () => {
    const dict = makeDictionary(["CAT", "dog"]);

    expect([dict.has("CAT"), dict.has("cat"), dict.has("DOG")]).toEqual([true, true, true]);
  });

  test("does not find a word that is absent", () => {
    expect(makeDictionary(["CAT"]).has("XQZ")).toBe(false);
  });
});
