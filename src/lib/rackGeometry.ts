/**
 * Where a pointer is over the rack, and how the rack's order changes when
 * something is dropped there.
 *
 * Kept out of the component because it is geometry rather than rendering, and
 * because getting it wrong is subtle: two earlier bugs came from asking the
 * question in the wrong frame of reference.
 */

interface RackTarget {
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

  // Layout positions (offsetLeft, offsetTop), not drawn ones: the rack keeps
  // its tiles in a fixed page order and slides each into its slot by
  // transform, so the i-th element's layout box is the i-th slot whichever
  // tile is showing there.
  const position = slotAt(
    clientX - bounds.left + rack.scrollLeft,
    clientY - bounds.top + rack.scrollTop,
    tiles.map((el) => ({
      left: el.offsetLeft,
      top: el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight,
    })),
  );
  return { overRack: true, position };
}

interface SlotBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The position a drop at (x, y) aims at, in the rack's own coordinates.
 *
 * The row is picked by `top` first and the column within it by `left`, so a
 * single row reads exactly as it always did: only x matters, because the tiles
 * are centred and there is empty rack either side of them. With several rows,
 * above the first or below the last means the start or the end.
 */
export function slotAt(x: number, y: number, slots: readonly SlotBox[]): number {
  if (slots.length === 0) return 0;

  const rowTops = [...new Set(slots.map((slot) => slot.top))].sort((a, b) => a - b);
  let top = rowTops[0];
  if (rowTops.length > 1) {
    const last = slots.filter((slot) => slot.top === rowTops[rowTops.length - 1]);
    if (y < rowTops[0]) return 0;
    if (y >= rowTops[rowTops.length - 1] + Math.max(...last.map((slot) => slot.height))) {
      return slots.length;
    }
    // The gap between two rows belongs to the row above it.
    top = rowTops.filter((rowTop) => rowTop <= y).pop() ?? rowTops[0];
  }

  const row = slots.flatMap((slot, index) => (slot.top === top ? [{ slot, index }] : []));
  if (x < row[0].slot.left) return row[0].index;
  for (const { slot, index } of row) {
    if (x < slot.left + slot.width) return index;
  }
  return row[row.length - 1].index + 1;
}

/**
 * How many slots across and down a tile travels going from slot `from` to slot
 * `to`, with the slots laid out row by row `columns` to a row. With no columns
 * everything is one row, which is the single-row rack.
 */
export function slotOffset(
  from: number,
  to: number,
  columns: number,
): { x: number; y: number } {
  if (columns <= 0) return { x: to - from, y: 0 };
  return {
    x: (to % columns) - (from % columns),
    y: Math.floor(to / columns) - Math.floor(from / columns),
  };
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
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}
