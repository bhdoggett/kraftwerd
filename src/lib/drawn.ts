/**
 * Where the fresh draw starts in `letters`, given the rack before it.
 *
 * The server hands a rack back as the letters kept, in their old order, and
 * then the new ones (`drawInto`), so the draw is whatever follows the longest
 * start of the new rack that the old one still contains in order.
 */
export function drawnFrom(before: readonly string[], after: readonly string[]): number {
  let i = 0;
  let j = 0;
  while (i < after.length && j < before.length) {
    if (after[i] === before[j]) i++;
    j++;
  }
  return i;
}
