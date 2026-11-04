import { describe, expect, test } from "vitest";
import { CLOSING, COACH, GAME_OVER_LINE } from "./coach";
import { standingsAfter } from "./model";
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

  test("the closing line gives the final scores, winner first", () => {
    const seats = [...standingsAfter(SCRIPT.length).seats].sort((a, b) => b.score - a.score);
    for (const s of seats) expect(CLOSING).toContain(String(s.score));
    expect(CLOSING).toContain(`${SEAT_NAMES[seats[0].seat]} wins with ${seats[0].score}`);
  });

  test("a single board cell is a spot; square means a 3×3", () => {
    for (const [i] of COACH.entries()) expect(text(i)).not.toMatch(/×\d square|squares are ×/);
  });

  test("turn two's instruction does not repeat its heading, in three sentences", () => {
    const before = COACH[1].before ?? "";
    expect(before).not.toMatch(/^Your move/);
    expect(before.split(/(?<=[.!])\s+/)).toHaveLength(3);
  });

  test("the game-over card line is not the closing line", () => {
    expect(GAME_OVER_LINE).not.toContain(CLOSING);
  });
});
