/**
 * What happens when a tile lands on a square that is already taken.
 *
 * A square holds one tile, so whatever was there leaves the board — which is
 * what puts it back on the rack, since the rack shows every letter not staged.
 * Refusing the drop instead was the other option, but a drop that silently
 * does nothing reads as the game being broken rather than as a rule.
 */

interface Placed {
  x: number;
  y: number;
}

const at = (p: Placed, x: number, y: number) => p.x === x && p.y === y;

/** Put `next` on its square, displacing whatever was there. */
export function stageAt<T extends Placed>(pending: readonly T[], next: T): T[] {
  return [...pending.filter((p) => !at(p, next.x, next.y)), next];
}

/** Move the tile staged at `from` to another square, displacing its occupant. */
export function moveStagedTo<T extends Placed>(
  pending: readonly T[],
  from: Placed,
  x: number,
  y: number,
): T[] {
  const tile = pending.find((p) => at(p, from.x, from.y));
  if (tile === undefined) return [...pending];

  return [
    ...pending.filter((p) => p !== tile && !at(p, x, y)),
    { ...tile, x, y },
  ];
}
