/** How long a replayed play takes, step by step. Shared by the game and the tutorial. */

/**
 * How long each play in the recap is pointed out: the four pulses of
 * `recent-play` in Board.module.css. A second longer than it was, so the
 * words and points in the announcement can actually be read.
 */
export const RECAP_PLAY_MS = 3200;

/**
 * How long a turn's points step lasts: a name and a number, so it needs far
 * less reading time than a spot's words.
 */
export const RECAP_POINTS_MS = 1600;

/**
 * How long the replay holds the board as you left it before the first play
 * lands: long enough to register as the position you remember.
 */
export const RECAP_LEAD_MS = 700;
