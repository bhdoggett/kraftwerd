import { describe, expect, test } from "vitest";
import { rematchLabel } from "./rematch";

describe("rematchLabel", () => {
  test("offers to play again while nobody has asked", () => {
    expect(rematchLabel(null)).toBe("Play again");
  });

  test("asks everybody else to join the one somebody made", () => {
    expect(rematchLabel({ joined: false })).toBe("Join rematch");
  });

  test("takes whoever is already sitting there back to it", () => {
    expect(rematchLabel({ joined: true })).toBe("Go to rematch");
  });
});
