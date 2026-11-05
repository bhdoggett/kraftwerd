import { describe, expect, test } from "vitest";
import { BOARD_SIZE, PLAYER_SEAT, SCRIPT, SEAT_NAMES } from "./script";
import { BLANK_HINT, CALLOUTS, CLOSING, INTRO, REPLAY_NOTE } from "./coach";
import { factsFor, standingsAfter, tilesAfter } from "./model";

const all = CALLOUTS.flat();

describe("callouts", () => {
  test("one entry per turn, at most two lines each", () => {
    expect(CALLOUTS).toHaveLength(SCRIPT.length);
    for (const c of CALLOUTS) expect(c.length).toBeLessThanOrEqual(2);
  });

  test("about the player's own moves, bar the one that changes whose turn it is", () => {
    const others = SCRIPT.flatMap((t, i) => (t.seat !== PLAYER_SEAT && CALLOUTS[i].length > 0 ? [i + 1] : []));
    expect(others).toEqual([13]);
  });

  test("each is short: a sentence or two, three at most", () => {
    for (const c of [...all, REPLAY_NOTE, { text: BLANK_HINT }, { text: INTRO }]) {
      expect(c.text.length, c.text).toBeLessThanOrEqual(140);
      expect(c.text.split(/(?<=[.!])\s+/).length, c.text).toBeLessThanOrEqual(3);
    }
  });

  test("each points at a square with a tile on it once the move is down", () => {
    CALLOUTS.forEach((callouts, i) => {
      const after = new Set(tilesAfter(i + 1).map((t) => `${t.x},${t.y}`));
      for (const c of callouts) {
        const [x, y] = c.cell.split(",").map(Number);
        expect(x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE, c.cell).toBe(true);
        expect(after.has(c.cell), `turn ${i + 1}: ${c.cell}`).toBe(true);
      }
    });
  });

  test("a 3×3 is mentioned only on a turn that closes one, pointing inside it", () => {
    CALLOUTS.forEach((callouts, i) => {
      const facts = factsFor(i);
      for (const c of callouts) {
        if (!c.text.includes("3×3")) continue;
        expect(facts.score.squares.length, `turn ${i + 1}`).toBeGreaterThan(0);
        expect(facts.newSquares, `turn ${i + 1}`).toContain(c.cell);
      }
    });
  });

  test("a word said to be multiplied was multiplied, and a +5 word was long", () => {
    CALLOUTS.forEach((callouts, i) => {
      const words = factsFor(i).score.words;
      const scored = (w: string) => words.filter((s) => s.word === w);
      for (const c of callouts) {
        const named = (c.text.match(/\b[A-Z]{2,}\b/g) ?? []).filter((w) => scored(w).length > 0);
        if (/tripled|doubles|run through|×12|hits the ×|crosses a ×/.test(c.text)) {
          expect(named.length, c.text).toBeGreaterThan(0);
          for (const w of named) expect(scored(w).some((s) => s.bonus !== undefined), `${w}, turn ${i + 1}`).toBe(true);
        }
        if (/\+5/.test(c.text)) {
          for (const w of named) expect(scored(w).some((s) => s.long), `${w}, turn ${i + 1}`).toBe(true);
        }
      }
    });
  });

  test("the replay note is the first stack by another player, on the stacked square", () => {
    const firstStack = SCRIPT.findIndex((t, i) => {
      if (t.seat === PLAYER_SEAT) return false;
      const before = new Set(tilesAfter(i).map((x) => `${x.x},${x.y}`));
      return t.placements.some((p) => before.has(`${p.x},${p.y}`));
    });
    expect(REPLAY_NOTE.turn).toBe(firstStack);
    const sitting = tilesAfter(REPLAY_NOTE.turn).find((x) => `${x.x},${x.y}` === REPLAY_NOTE.cell);
    const landing = SCRIPT[REPLAY_NOTE.turn].placements.find((p) => `${p.x},${p.y}` === REPLAY_NOTE.cell);
    expect(sitting).toMatchObject({ letter: "A", placedBy: `seat${PLAYER_SEAT}` });
    expect(landing?.letter).toBe("K");
  });

  test("a callout counting the places a move went down counts them right", () => {
    const words = ["one", "two", "three", "four"];
    CALLOUTS.forEach((callouts, i) => {
      for (const c of callouts) {
        const said = c.text.match(/\b(one|two|three|four) separate places\b/);
        if (said === null) continue;
        // Groups of this move's tiles, joined where they sit side by side.
        const left = [...SCRIPT[i].placements];
        let groups = 0;
        while (left.length > 0) {
          groups++;
          const queue = [left.pop()!];
          while (queue.length > 0) {
            const p = queue.pop()!;
            for (let j = left.length - 1; j >= 0; j--) {
              if (Math.abs(left[j].x - p.x) + Math.abs(left[j].y - p.y) === 1) queue.push(...left.splice(j, 1));
            }
          }
        }
        expect(words[groups - 1], `turn ${i + 1}`).toBe(said[1]);
      }
    });
    expect(CALLOUTS[10].some((c) => c.text.includes("three separate places"))).toBe(true);
  });

  test("names the right people", () => {
    for (const entry of [...all.map((c) => c.text), CLOSING, INTRO]) {
      for (const real of ["Clintron", "Ugona", "Ben"]) expect(entry).not.toContain(real);
    }
    for (const c of all) {
      for (const name of SEAT_NAMES) if (name !== SEAT_NAMES[PLAYER_SEAT]) expect(c.text).not.toContain(`${name}'s turn`);
    }
  });

  test("each rule is introduced", () => {
    const text = [...all.map((c) => c.text), BLANK_HINT, REPLAY_NOTE.text].join(" ").toLowerCase();
    for (const w of [
      "touches",
      "×3",
      "×4",
      "pays once",
      "3×3",
      "33",
      "last tile",
      "stacked",
      "2 tiles at most",
      "blank",
      "3 for the whole game",
      "+5",
      "flat +5",
      "out",
      "skipped",
      "bag is empty",
    ]) {
      expect(text, w).toContain(w);
    }
  });

  test("a single board cell is a spot; square means a 3×3", () => {
    for (const c of all) expect(c.text).not.toMatch(/×\d square|squares are ×/);
  });

  test("the closing line gives the final scores, winner first", () => {
    const seats = [...standingsAfter(SCRIPT.length).seats].sort((a, b) => b.score - a.score);
    for (const s of seats) expect(CLOSING).toContain(String(s.score));
    expect(CLOSING).toContain(`${SEAT_NAMES[seats[0].seat]} wins with ${seats[0].score}`);
  });
});
