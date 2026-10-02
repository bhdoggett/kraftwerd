import { describe, expect, test } from "vitest";
import { lexicon } from "./lexicon";

describe("lexicon", () => {
  test("each vocabulary is built once and kept", () => {
    expect(lexicon("common")).toBe(lexicon("common"));
  });

  test("the common list leaves out what the full list has", () => {
    expect(lexicon("full").dictionary.has("AAL")).toBe(true);
    expect(lexicon("common").dictionary.has("AAL")).toBe(false);
    expect(lexicon("common").dictionary.has("CAT")).toBe(true);
  });
}, 60_000);
