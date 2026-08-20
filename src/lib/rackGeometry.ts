/**
 * Where a pointer is over the rack, and how the rack's order changes when
 * something is dropped there.
 *
 * Kept out of the component because it is geometry rather than rendering, and
 * because getting it wrong is subtle: two earlier bugs came from asking the
 * question in the wrong frame of reference.
 */

/** Stands for the blank in the rack order, alongside the letters' indices. */
export const BLANK = -1;

export interface RackTarget {
  overRack: boolean;
  /** Position among the visible tiles, or null when not over the rack. */
  position: number | null;
}

/**
 * Which slot of the rack the pointer is in.
 *
 * Deliberately geometric rather than `elementFromPoint`, and expressed as a
 * position rather than a tile: during a drag the tiles are shifted by the
 * preview while their layout boxes stay put, so hit-testing sees them
 * somewhere other than the player does. `offsetLeft` is layout position and
 * does not move while only transforms change, and "which slot is the pointer
 * in" reads the same in both frames where "which tile is under it" does not.
 */
export function rackSlotUnder(clientX: number, clientY: number): RackTarget {
  const miss: RackTarget = { overRack: false, position: null };
  const rack = document.querySelector("[data-rack]");
  if (!(rack instanceof HTMLElement)) return miss;

  const tiles = [...rack.querySelectorAll("[data-rack-slot]")].filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );

  const bounds = rack.getBoundingClientRect();
  const insideRack =
    clientY >= bounds.top &&
    clientY <= bounds.bottom &&
    clientX >= bounds.left &&
    clientX <= bounds.right;

  // Every tile is out on the board: nothing to measure against, and nothing
  // that could be disturbed, so the whole rack takes the tile back.
  if (tiles.length === 0) {
    return insideRack ? { overRack: true, position: 0 } : miss;
  }
  if (!insideRack) return miss;

  // The tiles are centred, so there is empty rack either side of them. Left of
  // them means the start, right of them the end.
  const first = tiles[0]!.getBoundingClientRect();
  if (clientX < first.left) return { overRack: true, position: 0 };

  const localX = clientX - bounds.left + rack.scrollLeft;
  for (const [position, el] of tiles.entries()) {
    if (localX < el.offsetLeft + el.offsetWidth) return { overRack: true, position };
  }
  return { overRack: true, position: tiles.length };
}

/**
 * Move `value` to `position` among the tiles on show, keeping staged tiles
 * (which are hidden) after them. Positions are what the player is aiming at;
 * doing this over the full order would count tiles they cannot see.
 */
export function moveToPosition(
  order: readonly number[],
  hidden: readonly number[],
  value: number,
  position: number,
): number[] {
  const visible = order.filter((i) => !hidden.includes(i));
  const from = visible.indexOf(value);
  if (from < 0) return [...order];

  const next = [...visible];
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(position, next.length)), 0, value);

  return [...next, ...order.filter((i) => hidden.includes(i))];
}

export function shuffled(order: readonly number[]): number[] {
  const next = [...order];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
}
