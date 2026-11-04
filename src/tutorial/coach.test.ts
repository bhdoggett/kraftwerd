import { describe, expect, test } from "vitest";
import { CLOSING, COACH } from "./coach";
import { PLAYER_SEAT, SCRIPT, SEAT_NAMES } from "./script";

const text = (i: number) => `${COACH[i].before ?? ""} ${COACH[i].after}`;

describe("coach text", () => {
  test("one entry per turn", () => expect(COACH).toHaveLength(SCRIPT.length));

  test("player turns tell the player what to do first", () => {
    SCRIPT.forEach((t, i) => expect(Boolean(COACH[i].before)).toBe(t.seat === PLAYER_SEAT));
  });

  test("names the right people", () => {
    const all = [...COACH.map((_, i) => text(i)), CLOSING];
    for (const entry of all) {
      for (const real of ["Clintron", "Ugona", "Ben"]) expect(entry).not.toContain(real);
    }
    SCRIPT.forEach((t, i) => {
      if (t.seat !== PLAYER_SEAT) expect(text(i)).toContain(SEAT_NAMES[t.seat]);
    });
  });

  test("each concept is introduced", () => {
    const all = COACH.map((_, i) => text(i)).join(" ").toLowerCase();
    for (const w of ["centre", "both ways", "touch", "×2", "×3", "×4", "square", "33", "stack", "blank", "long word", "out"]) {
      expect(all).toContain(w);
    }
  });

  test("the closing line gives the final scores", () => {
    for (const s of ["264", "253", "239"]) expect(CLOSING).toContain(s);
  });
});
