import type { Placement } from "../../shared/engine/score";
import type { HintResult } from "../../shared/sim/coach";
import type { Selection } from "../components/Rack/Rack";

export type StagedHint = Placement & { from: Selection };

/**
 * A hint's tiles as a pending move: each placement mapped to a rack tile that
 * could make it, every tile used once. Null when the rack no longer holds the
 * letters -- the hint is for a rack that has since changed.
 */
export function stageHint(
  placements: readonly Placement[],
  letters: readonly string[],
): StagedHint[] | null {
  const used = new Set<number>();
  const staged: StagedHint[] = [];
  for (const p of placements) {
    if (p.isBlank) {
      staged.push({ ...p, from: { kind: "blank" } });
      continue;
    }
    const index = letters.findIndex((letter, i) => letter === p.letter && !used.has(i));
    if (index < 0) return null;
    used.add(index);
    staged.push({ ...p, from: { kind: "letter", index } });
  }
  return staged;
}

/** A result only belongs to the turn it was asked on; a late one is dropped. */
export function shownHint(result: HintResult | null, turnNumber: number): HintResult | null {
  return result !== null && result.turnNumber === turnNumber ? result : null;
}
