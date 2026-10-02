import { LONG_WORD_BONUS, SQUARE_BONUS } from "../../shared/config";
import type { HintMove } from "../../shared/sim/coach";

/** Why a hint scores, one short phrase per reason, biggest first. */
export function reasonsOf(move: HintMove): string[] {
  const reasons: string[] = [];
  if (move.squares === 1) reasons.push(`closes a 3×3 (+${SQUARE_BONUS})`);
  if (move.squares > 1) reasons.push(`closes ${move.squares} 3×3s (+${SQUARE_BONUS * move.squares})`);
  for (const w of move.words) {
    if (w.multiplier !== undefined) reasons.push(`×${w.multiplier} on ${w.word}`);
  }
  const long = move.words.filter((w) => w.long === true).length;
  if (long > 0) reasons.push(`long word (+${LONG_WORD_BONUS * long})`);
  if (move.leavesOpen > 0) reasons.push("leaves a 3×3 one tile short");
  return reasons;
}
