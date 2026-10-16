import { readFileSync } from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

/*
 * The replay ring (.recent::after in Board.module.css) pulses between two
 * colors. Nothing in a DOM test sees a keyframe, so this reads the CSS
 * itself: it resolves each end of the pulse to a real color, for every seat
 * on both themes, and checks the two ends are far enough apart to see.
 *
 * The accessibility pass once moved a fresh tile's ring to end on the ink
 * (--tile-text). On the dark board that pulsed from #060608 to #0b0b0d --
 * black to black -- and the ring stopped pulsing at all.
 */

const here = path.dirname(new URL(import.meta.url).pathname);
const boardCss = readFileSync(path.join(here, "Board.module.css"), "utf8");
const tokensCss = readFileSync(path.join(here, "../../index.css"), "utf8");

/** The `--name: value` pairs declared directly in the block for `selector`. */
function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no block for ${selector}`);
  const body = css.slice(
    css.indexOf("{", start) + 1,
    css.indexOf("\n}", start),
  );
  const vars: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    vars[name] = value.trim();
  }
  return vars;
}

/** `from` and `to` of a keyframe that animates only border-color. */
function keyframe(name: string): { from: string; to: string } {
  const start = boardCss.indexOf(`@keyframes ${name} {`);
  if (start < 0) throw new Error(`no @keyframes ${name}`);
  const body = boardCss.slice(start, boardCss.indexOf("\n}", start));
  const end = (at: string) => {
    const match = body.match(
      new RegExp(`${at}\\s*{\\s*border-color:\\s*([^;]+);`),
    );
    if (!match) throw new Error(`@keyframes ${name} has no ${at} border-color`);
    return match[1].trim();
  };
  return { from: end("from"), to: end("to") };
}

/** Follows var() until it lands on a hex color. */
function resolve(value: string, vars: Record<string, string>): string {
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (ref) {
    const next = vars[ref[1]];
    if (next === undefined) throw new Error(`${ref[1]} is not defined`);
    return resolve(next, vars);
  }
  if (!/^#[0-9a-f]{6}$/i.test(value))
    throw new Error(`cannot resolve ${value}`);
  return value;
}

/*
 * How far apart two colors are, straight-line in RGB. Not a contrast ratio:
 * paper to gold is only 1.25:1 in luminance yet an obvious change of hue,
 * while #060608 to #0b0b0d is 9 apart out of 441 -- no change at all.
 */
function distance(a: string, b: string): number {
  const channels = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [channels(a), channels(b)];
  return Math.hypot(...x.map((c, i) => c - y[i]));
}

const light = block(tokensCss, ':root,\n[data-theme="light"]');
const themes = {
  light,
  dark: { ...light, ...block(tokensCss, '[data-theme="dark"]') },
};
const seats = ["0", "1", "2"];

describe("replay ring", () => {
  test("a fresh tile's ring pulses from board to the seat's color", () => {
    expect(keyframe("recent-play")).toEqual({
      from: "var(--cell-empty)",
      to: "var(--seat-full)",
    });
  });

  test("a stacked square's ring pulses from the seat's color to board", () => {
    expect(keyframe("recent-play-stacked")).toEqual({
      from: "var(--seat-lit)",
      to: "var(--cell-empty)",
    });
  });

  for (const [theme, base] of Object.entries(themes)) {
    for (const seat of seats) {
      const vars = { ...base, ...block(tokensCss, `[data-seat="${seat}"]`) };
      for (const name of ["recent-play", "recent-play-stacked"]) {
        test(`${name} visibly changes for seat ${seat} on ${theme}`, () => {
          const { from, to } = keyframe(name);
          expect(
            distance(resolve(from, vars), resolve(to, vars)),
          ).toBeGreaterThan(80);
        });
      }
    }
  }
});
