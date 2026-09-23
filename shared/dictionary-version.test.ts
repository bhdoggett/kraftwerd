import { describe, expect, test } from "vitest";
import { DICTIONARY_WORDS, RULES_VERSION } from "./config";
import WORDS from "./data/words.json" with { type: "json" };

/**
 * The word list is part of the rules, and this is what says so out loud.
 *
 * Which words play decides what a rack is worth and what a board can become,
 * so two games played against different dictionaries are not competing -- as
 * surely as two played from different bags. That had been slipping: the
 * dictionary went from SCOWL's 76,911 words to ENABLE + 12dicts' 172,788, and
 * then to 175,800 when a line-ending bug stopped dropping the second source,
 * and `RULES_VERSION` sat at 5 through all of it.
 *
 * So the count is written down in the config, and this test holds the shipped
 * list to it. Rebuild the dictionary and this goes red -- which is the moment
 * to decide whether the change deserves a new `RULES_VERSION`, rather than
 * noticing months later that a record was set against a different language.
 */
describe("the shipped dictionary", () => {
  test("is the one the rules version was set for", () => {
    expect(WORDS.length).toBe(DICTIONARY_WORDS);
  });

  test("counts as rules: changing the list means changing the version", () => {
    // The list is still the ENABLE + 12dicts one at 175,800 words; it has not
    // moved since version 7 (design.md §4.8). Versions 9 and 10 are scoring
    // changes, unrelated to the list -- this test going red whenever either
    // half moves is the point of it, not a failure.
    expect(RULES_VERSION).toBe(10);
    expect(DICTIONARY_WORDS).toBe(175800);
  });
});
