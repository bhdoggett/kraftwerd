/**
 * The tiles staged for a turn nobody has played yet, kept so a reload or a
 * re-mount does not lose them.
 *
 * Out here rather than inside the game screen because there is a rule about
 * when a draft is still good, and a rule wants somewhere it can be tested.
 */
const draftKey = (gameId: string) => `kraftwerd:draft:${gameId}`;

/** The key used before the rename. Read once, then dropped. */
const legacyDraftKey = (gameId: string) => `wordcraft:draft:${gameId}`;

function forget(gameId: string) {
  window.localStorage.removeItem(draftKey(gameId));
  window.localStorage.removeItem(legacyDraftKey(gameId));
}

/**
 * The draft for this turn, or nothing.
 *
 * A draft belongs to a turn *of a game that can still be played*, and both
 * halves matter. Stamping it with the turn alone was not enough: quitting
 * ends a game without moving the turn on, so a draft went on matching, and
 * came back on a board nobody could play -- the staged tiles, and the words
 * chipped and crossed out beside them. A game that is over forgets its draft
 * rather than holding it against a turn that will never be taken.
 */
export function readDraft<T>(
  gameId: string,
  turnNumber: number,
  playable: boolean,
): T[] {
  try {
    if (!playable) {
      forget(gameId);
      return [];
    }

    let raw = window.localStorage.getItem(draftKey(gameId));
    if (raw === null) {
      raw = window.localStorage.getItem(legacyDraftKey(gameId));
      if (raw !== null) window.localStorage.removeItem(legacyDraftKey(gameId));
    }
    if (raw === null) return [];

    const parsed = JSON.parse(raw) as { turnNumber: number; pending: T[] };
    return parsed.turnNumber === turnNumber ? parsed.pending : [];
  } catch {
    return [];
  }
}

export function writeDraft<T>(
  gameId: string,
  turnNumber: number,
  pending: readonly T[],
  playable: boolean,
) {
  try {
    if (!playable || pending.length === 0) forget(gameId);
    else {
      window.localStorage.setItem(
        draftKey(gameId),
        JSON.stringify({ turnNumber, pending }),
      );
    }
  } catch {
    // Private browsing or a full quota: a lost draft is not worth failing over.
  }
}
