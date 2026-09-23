import { describe, expect, test } from "vitest";
import { RULES_VERSION } from "../../../shared/config";
import { changesSince, RULE_CHANGES } from "./changes";

describe("rule changes", () => {
  test("the current rules version says what changed", () => {
    // Red after a RULES_VERSION bump: write the entry players will see.
    expect(RULE_CHANGES.some((entry) => entry.version === RULES_VERSION)).toBe(true);
  });

  test("a player sees only what is newer than what they have seen", () => {
    expect(changesSince(RULES_VERSION)).toEqual([]);
    expect(changesSince(RULES_VERSION - 1).map((e) => e.version)).toEqual([RULES_VERSION]);
  });
});
