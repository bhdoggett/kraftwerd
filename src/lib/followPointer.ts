/**
 * Follow the pointer across the whole window.
 *
 * Window-level rather than on an element, so a drag that leaves the element it
 * started on keeps going, and letting go anywhere ends it -- a cancelled
 * pointer included. Returns the cleanup, so an effect can hand it straight
 * back.
 */
export function followPointer(
  onMove: (e: PointerEvent) => void,
  onUp: (e: PointerEvent) => void,
): () => void {
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  return () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };
}
