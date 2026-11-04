import type { Feedback } from "./model";

/** What a press of Play too early is told, in one short line. */
export function describeFeedback(f: Feedback): string {
  switch (f.kind) {
    case "offGhost": {
      const dx = f.target.x - f.x;
      const dy = f.target.y - f.y;
      let where = `marked ${f.letter}`;
      if (Math.abs(dx) + Math.abs(dy) === 1) {
        where = `one square ${dx === -1 ? "left" : dx === 1 ? "right" : dy === -1 ? "up" : "down"}`;
      }
      return `The ${f.letter} goes on the glowing square ${where}.`;
    }
    case "wrongLetter":
      return `That square wants ${f.wanted}, not ${f.placed}.`;
    case "missing":
      return `${f.count} more ${f.count === 1 ? "tile" : "tiles"} to place.`;
    case "ready":
      return "";
  }
}
