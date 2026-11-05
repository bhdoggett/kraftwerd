/**
 * How the tutorial paces other players' moves: quicker than a game's replay,
 * since nobody is catching up on anything. Each move lands whole, one player
 * at a time.
 */

/** The pause before a move lands, so it is plain whose turn it is. */
export const LEAD_MS = 500;

/** How long a landed move is shown, words and points together, before the next turn. */
export const SHOW_MS = 1800;

/** How long the player may sit on their turn before the next tile is nudged. */
export const IDLE_MS = 8000;
